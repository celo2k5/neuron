import { makeDataset, parameterCount, trainingIssues, type DatasetId, type TrainOptions } from "@neuron/engine";
import { one, q, emit, type Db } from "./db";
import { env } from "./env";
import { enqueue } from "./jobs";
import { loadVersion } from "./models";
import { reserve, settle } from "./credits";
import { bad, conflict, forbidden, notFound } from "./http";

export interface TrainingRow {
  id: string; owner_id: string; model_id: string; base_version_id: string; dataset: string; dataset_hash: string;
  options: TrainOptions & { samples: number }; status: string; epoch: number; history: unknown[]; baseline: unknown;
  credits_reserved: number; job_id: string | null; error: string | null; resource: unknown; created_at: string; updated_at: string;
  base_version?: number;
}

/** Compute cost in credits: proportional to sample-epochs × parameters. */
export const trainingCost = (epochs: number, samples: number, params: number) => Math.max(1, Math.ceil((epochs * samples * params) / 2_000_000));

export async function startTraining(db: Db, ownerId: string, a: { modelId: string; version?: number; dataset: DatasetId; samples: number } & TrainOptions, resumeOf?: string) {
  const { model, versionId } = await loadVersion(db, a.modelId, a.version);
  const ds = makeDataset(a.dataset, a.samples, "neuron");
  const opts: TrainOptions = { optimizer: a.optimizer, learningRate: a.learningRate, epochs: a.epochs, batchSize: a.batchSize, valFraction: a.valFraction, momentum: a.momentum ?? 0, seed: "neuron" };
  const issues = trainingIssues(model, ds, opts);
  if (issues.length) throw bad(issues.join("; "), issues);
  const running = await one("select 1 from training_jobs where owner_id = $1 and status in ('queued','running')", [ownerId], db);
  if (running) throw conflict("You already have a training job running. Wait for it, or cancel it first.");
  const e = env();
  const free = await one<{ n: number }>("select count(*)::int as n from training_jobs where owner_id = $1 and created_at > now() - interval '1 day' and credits_reserved = 0", [ownerId], db);
  const isFree = (free?.n ?? 0) < e.FREE_TRAINING_PER_DAY && a.epochs <= e.FREE_TRAINING_MAX_EPOCHS;
  const cost = isFree ? 0 : trainingCost(a.epochs, a.samples, parameterCount(model));
  const row = (await one<{ id: string }>(
    `insert into training_jobs (owner_id, model_id, base_version_id, dataset, dataset_hash, options, credits_reserved)
     values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [ownerId, a.modelId, versionId, a.dataset, ds.hash, { ...opts, samples: a.samples, resumeOf: resumeOf ?? null }, cost], db))!;
  if (cost) await reserve(db, ownerId, cost, "training", row.id);
  const jobId = await enqueue(db, "training", { trainingId: row.id }, { idempotencyKey: `training:${row.id}`, maxAttempts: 2 });
  await db.query("update training_jobs set job_id = $2 where id = $1", [row.id, jobId]);
  await emit(db, "training.queued", row.id, { modelId: a.modelId, cost }, ownerId);
  return { id: row.id, cost };
}

export async function getTraining(db: Db, id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw notFound();
  const t = await one<TrainingRow>("select t.*, v.version as base_version from training_jobs t join model_versions v on v.id = t.base_version_id where t.id = $1", [id], db);
  if (!t) throw notFound("Training job not found.");
  const checkpoints = await q("select c.id, c.epoch, c.metrics, c.artifact_hash, v.version, c.created_at from checkpoints c join model_versions v on v.id = c.model_version_id where c.training_job_id = $1 order by c.epoch", [id], db);
  return { ...t, checkpoints };
}

/** pause = stop at the next epoch boundary and keep a checkpoint; cancel = stop and release unused credits. */
export async function stopTraining(db: Db, ownerId: string, id: string, mode: "cancel" | "pause") {
  const t = await one<TrainingRow>("select * from training_jobs where id = $1 for update", [id], db);
  if (!t) throw notFound();
  if (t.owner_id !== ownerId) throw forbidden("Only the job owner can stop it.");
  if (t.status === "queued") {
    await db.query("update jobs set status = 'cancelled', updated_at = now() where id = $1 and status = 'queued'", [t.job_id]);
    await db.query("update training_jobs set status = $2, updated_at = now() where id = $1", [id, mode === "pause" ? "paused" : "cancelled"]);
    await settle(db, ownerId, t.credits_reserved, 0, "training", id);
    await emit(db, `training.${mode === "pause" ? "paused" : "cancelled"}`, id, {}, ownerId);
    return { status: mode === "pause" ? "paused" : "cancelled" };
  }
  if (t.status !== "running") throw conflict(`Job is ${t.status}.`);
  await db.query("update jobs set cancel_requested = true, result = jsonb_build_object('stopMode', $2::text) where id = $1", [t.job_id, mode]);
  return { status: "stopping" };
}

/** Resume a paused job: continue from its latest checkpoint for the remaining epochs. */
export async function resumeTraining(db: Db, ownerId: string, id: string) {
  const t = await one<TrainingRow>("select * from training_jobs where id = $1", [id], db);
  if (!t) throw notFound();
  if (t.owner_id !== ownerId) throw forbidden("Only the job owner can resume it.");
  if (t.status !== "paused") throw conflict("Only paused jobs can be resumed.");
  const ck = await one<{ version: number }>("select v.version from checkpoints c join model_versions v on v.id = c.model_version_id where c.training_job_id = $1 order by c.epoch desc limit 1", [id], db);
  const base = ck?.version ?? (await one<{ version: number }>("select version from model_versions where id = $1", [t.base_version_id], db))!.version;
  const remaining = Math.max(1, t.options.epochs - t.epoch);
  return startTraining(db, ownerId, { ...t.options, modelId: t.model_id, version: base, dataset: t.dataset as DatasetId, samples: t.options.samples, epochs: remaining }, id);
}

export async function listTraining(db: Db, f: { modelId?: string; ownerId?: string; limit: number }) {
  const where: string[] = []; const p: unknown[] = [];
  if (f.modelId) { p.push(f.modelId); where.push(`model_id = $${p.length}`); }
  if (f.ownerId) { p.push(f.ownerId); where.push(`owner_id = $${p.length}`); }
  p.push(f.limit);
  return q<TrainingRow>(`select id, model_id, dataset, options, status, epoch, baseline, credits_reserved, error, created_at, updated_at,
      (history -> -1) as last from training_jobs ${where.length ? "where " + where.join(" and ") : ""} order by created_at desc limit $${p.length}`, p, db);
}

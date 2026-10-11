import { assertVector, compareOutputs, hashCanonical, resultHashOf, runExperiment, ENGINE_VERSION } from "@neuron/engine";
import { one, q, emit, type Db } from "./db";
import { env } from "./env";
import { enqueue } from "./jobs";
import { loadVersion } from "./models";
import { reserve, settle } from "./credits";
import { putArtifact } from "./artifacts";
import { notFound } from "./http";

export interface ExperimentRow {
  id: string; owner_id: string | null; owner_wallet?: string | null; model_version_id: string; model_id: string; network_version_id: string | null;
  status: string; input_source: string; input: number[]; input_seed: string | null; output: number[] | null;
  activations_hash: string | null; activation_summary: { layer: number; min: number; max: number; mean: number; values?: number[] }[] | null;
  result_hash: string | null; metadata_hash: string | null; engine: string | null; elapsed_ms: number | null; error: string | null;
  job_id: string | null; reproduced_from: string | null; repro: unknown; created_at: string; completed_at: string | null;
  version?: number; artifact_hash?: string; commitment_status?: string | null; commitment_signature?: string | null;
}

export const metadataHashOf = (e: { id: string; model_id: string; version: number; input_source: string; input_seed: string | null; network_version_id: string | null }) =>
  hashCanonical({ experiment: e.id, model: e.model_id, version: e.version, inputSource: e.input_source, inputSeed: e.input_seed, networkVersion: e.network_version_id, engine: ENGINE_VERSION });

export async function createExperiment(db: Db, args: {
  modelId: string; version?: number; input: number[]; inputSource: "manual" | "seeded" | "dataset"; inputSeed?: string;
  ownerId: string | null; reproducedFrom?: string; networkVersionId?: string;
}) {
  const { model, versionId } = await loadVersion(db, args.modelId, args.version);
  assertVector(args.input, model.config.inputDim, "input");
  let cost = 0;
  if (args.ownerId && !args.reproducedFrom) {
    const today = await one<{ n: number }>("select count(*)::int as n from experiments where owner_id = $1 and created_at > now() - interval '1 day' and reproduced_from is null", [args.ownerId], db);
    if ((today?.n ?? 0) >= env().FREE_EXPERIMENTS_PER_DAY) cost = 1;
  }
  const row = (await one<{ id: string }>(
    `insert into experiments (owner_id, model_version_id, model_id, network_version_id, input_source, input, input_seed, reproduced_from)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [args.ownerId, versionId, args.modelId, args.networkVersionId ?? null, args.inputSource, JSON.stringify(args.input), args.inputSeed ?? null, args.reproducedFrom ?? null], db))!;
  if (cost && args.ownerId) await reserve(db, args.ownerId, cost, "experiment", row.id);
  const jobId = await enqueue(db, "experiment", { experimentId: row.id, cost }, { idempotencyKey: `experiment:${row.id}` });
  await db.query("update experiments set job_id = $2 where id = $1", [row.id, jobId]);
  await emit(db, "experiment.queued", row.id, { modelId: args.modelId }, args.ownerId);
  return { id: row.id, jobId, cost };
}

/** Worker: execute an experiment. Idempotent: a completed experiment is not re-run. */
export async function executeExperiment(db: Db, experimentId: string, cost: number) {
  const e = await one<ExperimentRow & { version: number }>(
    `select e.*, v.version from experiments e join model_versions v on v.id = e.model_version_id where e.id = $1 for update of e`, [experimentId], db);
  if (!e) throw new Error("experiment vanished");
  if (e.status === "completed") return { skipped: true };
  await db.query("update experiments set status = 'running' where id = $1", [experimentId]);
  const { model } = await loadVersion(db, e.model_id, e.version);
  const rec = runExperiment(model, e.input);
  const activationsHash = await putArtifact(db, "activations", { experimentId, artifactHash: rec.artifactHash, activations: rec.activations });
  const summary = rec.activations.map((v, layer) => ({
    layer, min: Math.min(...v), max: Math.max(...v), mean: v.reduce((s, x) => s + x, 0) / v.length, values: v.length <= 64 ? v : undefined,
  }));
  const metadataHash = metadataHashOf({ ...e, version: e.version });
  let repro: unknown = null;
  if (e.reproduced_from) {
    const orig = await one<{ output: number[]; result_hash: string }>("select output, result_hash from experiments where id = $1", [e.reproduced_from], db);
    if (orig?.output) repro = { ...compareOutputs(orig.output, rec.output), originalResultHash: orig.result_hash, sameHash: orig.result_hash === rec.resultHash };
  }
  await db.query(
    `update experiments set status = 'completed', output = $2, activations_hash = $3, activation_summary = $4, result_hash = $5,
       metadata_hash = $6, engine = $7, elapsed_ms = $8, repro = $9, completed_at = now() where id = $1`,
    [experimentId, JSON.stringify(rec.output), activationsHash, JSON.stringify(summary), rec.resultHash, metadataHash, rec.engine, rec.elapsedMs, repro]);
  if (cost && e.owner_id) await settle(db, e.owner_id, cost, cost, "experiment", experimentId);
  await emit(db, "experiment.completed", experimentId, { modelId: e.model_id, resultHash: rec.resultHash }, e.owner_id);
  return { resultHash: rec.resultHash };
}

export async function failExperiment(db: Db, experimentId: string, error: string, cost: number) {
  const e = await one<{ owner_id: string | null }>("update experiments set status = 'failed', error = $2, completed_at = now() where id = $1 and status <> 'completed' returning owner_id", [experimentId, error.slice(0, 500)], db);
  if (e?.owner_id && cost) await settle(db, e.owner_id, cost, 0, "experiment", experimentId);
  await emit(db, "experiment.failed", experimentId, { error: error.slice(0, 200) }, e?.owner_id ?? null);
}

const SELECT = `select e.*, v.version, v.artifact_hash, u.wallet as owner_wallet, c.status as commitment_status, c.signature as commitment_signature
  from experiments e join model_versions v on v.id = e.model_version_id
  left join users u on u.id = e.owner_id left join commitments c on c.experiment_id = e.id`;

export async function getExperiment(db: Db, id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw notFound();
  const e = await one<ExperimentRow>(`${SELECT} where e.id = $1`, [id], db);
  if (!e) throw notFound("Experiment not found.");
  return e;
}

export async function listExperiments(db: Db, f: { modelId?: string; owner?: string; status?: string; limit: number; before?: string }) {
  const where: string[] = []; const p: unknown[] = [];
  if (f.modelId) { p.push(f.modelId); where.push(`e.model_id = $${p.length}`); }
  if (f.owner) { p.push(f.owner); where.push(`u.wallet = $${p.length}`); }
  if (f.status) { p.push(f.status); where.push(`e.status = $${p.length}`); }
  if (f.before) { p.push(f.before); where.push(`e.created_at < $${p.length}::timestamptz`); }
  p.push(f.limit + 1);
  const rows = await q<ExperimentRow>(`${SELECT} ${where.length ? "where " + where.join(" and ") : ""} order by e.created_at desc limit $${p.length}`, p, db);
  return { items: rows.slice(0, f.limit), next: rows.length > f.limit ? rows[f.limit - 1].created_at : null };
}

/** Recompute hashes from stored fields — the tamper check that runs before any on-chain comparison. */
export async function recomputeHashes(db: Db, e: ExperimentRow) {
  if (!e.output || !e.engine) return null;
  const v = await one<{ artifact_hash: string; config_hash: string; version: number }>(
    "select v.artifact_hash, m.config_hash, v.version from model_versions v join models m on m.id = v.model_id where v.id = $1", [e.model_version_id], db);
  if (!v) return null;
  return {
    resultHash: resultHashOf({ engine: e.engine, artifactHash: v.artifact_hash, configHash: v.config_hash, input: e.input, output: e.output }),
    metadataHash: metadataHashOf({ ...e, version: v.version }),
    artifactHash: v.artifact_hash,
  };
}

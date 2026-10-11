import { Worker } from "node:worker_threads";
import { importModel, ENGINE_VERSION, type EpochMetrics, type ModelArtifact } from "@neuron/engine";
import { one, pool, tx, emit } from "./db";
import { getArtifact, putArtifact } from "./artifacts";
import { settle } from "./credits";
import type { TrainingRow } from "./training";
import { log } from "./log";

export const TRAINING_RESOURCE_LIMITS = { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 48, wallClockMs: 180_000 };

type Msg =
  | { type: "baseline"; baseline: unknown }
  | { type: "epoch"; m: EpochMetrics }
  | { type: "checkpoint"; epoch: number; metrics: EpochMetrics; artifact: ModelArtifact }
  | { type: "done"; epochs: number; stopped: boolean; peakHeapMb: number; ms: number }
  | { type: "error"; message: string };

export async function runTraining(jobId: string, trainingId: string, threadUrl: URL) {
  const db = pool();
  const t = await one<TrainingRow & { base_artifact: string; base_version: number }>(
    `select t.*, v.artifact_hash as base_artifact, v.version as base_version from training_jobs t join model_versions v on v.id = t.base_version_id where t.id = $1`, [trainingId]);
  if (!t) throw new Error("training job vanished");
  if (!["queued", "running"].includes(t.status)) return { skipped: t.status };
  await db.query("update training_jobs set status = 'running', updated_at = now() where id = $1", [trainingId]);
  await emit(db, "training.running", trainingId, { modelId: t.model_id }, t.owner_id);
  const artifact = await getArtifact<ModelArtifact>(db, t.base_artifact);
  importModel(artifact); // validate before handing to the thread

  const history: EpochMetrics[] = [];
  let epoch = 0, lastFlush = 0, stopMode: "cancel" | "pause" | null = null;
  const every = Math.max(5, Math.ceil(t.options.epochs / 4));

  const worker = new Worker(threadUrl, {
    workerData: { artifact, dataset: t.dataset, samples: t.options.samples, options: t.options, checkpointEvery: every },
    resourceLimits: { maxOldGenerationSizeMb: TRAINING_RESOURCE_LIMITS.maxOldGenerationSizeMb, maxYoungGenerationSizeMb: TRAINING_RESOURCE_LIMITS.maxYoungGenerationSizeMb },
  });
  const killer = setTimeout(() => { log.warn("training_timeout", { trainingId }); worker.postMessage("stop"); setTimeout(() => worker.terminate(), 5000); }, TRAINING_RESOURCE_LIMITS.wallClockMs);

  const flush = async (force = false) => {
    if (!force && Date.now() - lastFlush < 750) return;
    lastFlush = Date.now();
    await db.query("update training_jobs set epoch = $2, history = $3, updated_at = now() where id = $1", [trainingId, epoch, JSON.stringify(history)]);
    const j = await one<{ cancel_requested: boolean; result: { stopMode?: "cancel" | "pause" } | null }>(
      "update jobs set heartbeat_at = now() where id = $1 returning cancel_requested, result", [jobId]);
    if (j?.cancel_requested && !stopMode) { stopMode = j.result?.stopMode ?? "cancel"; worker.postMessage("stop"); }
    await emit(db, "training.progress", trainingId, { epoch, last: history[history.length - 1] ?? null }, t.owner_id);
  };

  const saveCheckpoint = async (m: Extract<Msg, { type: "checkpoint" }>) => {
    await tx(async (c) => {
      await c.query("select 1 from models where id = $1 for update", [t.model_id]);
      const model = importModel(m.artifact);
      const next = (await one<{ v: number }>("select coalesce(max(version),0)+1 as v from model_versions where model_id = $1", [t.model_id], c))!.v;
      const existing = await one<{ id: string; version: number }>("select id, version from model_versions where model_id = $1 and artifact_hash = $2", [t.model_id, model.artifactHash], c);
      const hash = await putArtifact(c, "checkpoint", { ...m.artifact, version: existing?.version ?? next }, model.artifactHash);
      const vid = existing?.id ?? (await one<{ id: string }>(
        `insert into model_versions (model_id, version, artifact_hash, parent_artifact_hash, trained, training_job_id, engine, metrics)
         values ($1,$2,$3,$4,true,$5,$6,$7) returning id`,
        [t.model_id, next, hash, m.artifact.parentArtifactHash ?? t.base_artifact, trainingId, ENGINE_VERSION, m.metrics], c))!.id;
      await c.query("insert into checkpoints (training_job_id, model_version_id, epoch, metrics, artifact_hash) values ($1,$2,$3,$4,$5) on conflict do nothing",
        [trainingId, vid, m.epoch, m.metrics, hash]);
      await emit(c, "training.checkpoint", trainingId, { epoch: m.epoch, version: existing?.version ?? next }, t.owner_id);
    });
  };

  return new Promise<unknown>((resolve, reject) => {
    let chain = Promise.resolve();
    let finished = false;
    const finish = (fn: () => Promise<unknown>) => { chain = chain.then(fn).catch((e) => { finished = true; clearTimeout(killer); reject(e); }) as Promise<void>; };
    worker.on("message", (m: Msg) => finish(async () => {
      if (m.type === "baseline") await db.query("update training_jobs set baseline = $2 where id = $1", [trainingId, m.baseline]);
      else if (m.type === "epoch") { history.push(m.m); epoch = m.m.epoch; await flush(); }
      else if (m.type === "checkpoint") await saveCheckpoint(m);
      else if (m.type === "error") throw new Error(m.message);
      else if (m.type === "done") {
        clearTimeout(killer); finished = true;
        await flush(true);
        const status = stopMode === "pause" ? "paused" : stopMode === "cancel" ? "cancelled" : m.stopped ? "completed" : "completed";
        const used = status === "completed" ? t.credits_reserved : Math.ceil((t.credits_reserved * epoch) / Math.max(1, t.options.epochs));
        await tx(async (c) => {
          await c.query("update training_jobs set status = $2, resource = $3, updated_at = now() where id = $1", [trainingId, status, { peakHeapMb: m.peakHeapMb, ms: m.ms, limits: TRAINING_RESOURCE_LIMITS }]);
          await settle(c, t.owner_id, t.credits_reserved, used, "training", trainingId);
          await emit(c, `training.${status}`, trainingId, { epoch }, t.owner_id);
        });
        await worker.terminate();
        resolve({ status, epoch });
      }
    }));
    worker.on("error", (e) => finish(async () => { throw e; }));
    worker.on("exit", (code) => finish(async () => {
      if (!finished) throw new Error(`training thread exited (${code}) — likely hit its memory or time limit`);
    }));
  }).catch(async (e: Error) => {
    await tx(async (c) => {
      await c.query("update training_jobs set status = 'failed', error = $2, epoch = $3, history = $4, updated_at = now() where id = $1", [trainingId, e.message.slice(0, 500), epoch, JSON.stringify(history)]);
      const used = Math.ceil((t.credits_reserved * epoch) / Math.max(1, t.options.epochs));
      await settle(c, t.owner_id, t.credits_reserved, used, "training", trainingId);
      await emit(c, "training.failed", trainingId, { error: e.message.slice(0, 200) }, t.owner_id);
    });
    throw Object.assign(e, { retryable: false });
  });
}

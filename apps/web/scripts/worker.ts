/**
 * NEURON worker: durable Postgres job queue (FOR UPDATE SKIP LOCKED) for experiments, training,
 * optional token-payment reconciliation and governance execution.
 * Run: npm run worker   (reads the same env as the web app)
 */
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildSync } from "esbuild";
import { pool, tx, one } from "../src/lib/server/db";
import { claim, complete, fail, requeueStale, type JobKind } from "../src/lib/server/jobs";
import { executeExperiment, failExperiment } from "../src/lib/server/experiments";
import { runTraining } from "../src/lib/server/training-runner";
import { reconcileIntent } from "../src/lib/server/payments";
import { processProposal } from "../src/lib/server/governance";
import { ensureNetwork } from "../src/lib/server/community";
import { env } from "../src/lib/server/env";
import { ensureSettings } from "../src/lib/server/settings-sync";
import { log } from "../src/lib/server/log";

const WORKER_ID = `${os.hostname()}-${process.pid}`;
const KINDS: JobKind[] = ["experiment", "training", "reconcile_payment", "governance_execute"];
const MAX_CONCURRENT = Number(process.env.WORKER_CONCURRENCY ?? 3);
// The training thread is bundled once at startup so it runs as plain JS with no loader hooks.
const threadUrl = (() => {
  const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".cache", "train-thread.mjs");
  buildSync({ entryPoints: [fileURLToPath(new URL("./train-thread.ts", import.meta.url))], bundle: true, platform: "node", format: "esm", target: "node20", outfile: out, logLevel: "error" });
  return pathToFileURL(out);
})();
let running = 0, stopping = false;

class Retry extends Error { constructor(m: string, public runAfter?: Date) { super(m); } }

async function handle(job: { id: string; kind: JobKind; payload: Record<string, unknown> }) {
  const p = job.payload;
  switch (job.kind) {
    case "experiment": {
      const id = String(p.experimentId), cost = Number(p.cost ?? 0);
      try { return await tx((db) => executeExperiment(db, id, cost)); }
      catch (e) { await tx((db) => failExperiment(db, id, (e as Error).message, cost)); throw Object.assign(e as Error, { retryable: false }); }
    }
    case "training": return runTraining(job.id, String(p.trainingId), threadUrl);
    case "reconcile_payment": {
      const r = await reconcileIntent(pool(), String(p.intentId));
      if (r.retry) throw new Retry(r.reason ?? "awaiting finality");
      return r;
    }
    case "governance_execute": {
      const r = await tx((db) => processProposal(db, String(p.proposalId)));
      if (!r.done) throw new Retry("waiting for proposal deadline", r.runAfter);
      return r;
    }
  }
}

async function runOne() {
  const job = await claim(pool(), WORKER_ID, KINDS);
  if (!job) return false;
  running++;
  const t0 = Date.now();
  const beat = setInterval(() => pool().query("update jobs set heartbeat_at = now() where id = $1", [job.id]).catch(() => {}), 10_000);
  (async () => {
    try {
      const result = await handle(job);
      await complete(pool(), job.id, result ?? null);
      log.info("job_done", { job: job.id, kind: job.kind, ms: Date.now() - t0 });
    } catch (e) {
      if (e instanceof Retry) {
        // waiting is not a failure: put it back without burning an attempt
        await pool().query(`update jobs set status = 'queued', attempts = greatest(0, attempts - 1), locked_by = null,
            run_after = coalesce($2, now() + interval '3 seconds'), last_error = $3, updated_at = now() where id = $1`, [job.id, e.runAfter ?? null, e.message]);
      } else {
        const retryable = (e as { retryable?: boolean }).retryable !== false;
        const dead = await fail(pool(), job.id, (e as Error).message, retryable);
        log[dead ? "error" : "warn"]("job_failed", { job: job.id, kind: job.kind, error: (e as Error).message, dead });
      }
    } finally {
      clearInterval(beat);
      running--;
    }
  })();
  return true;
}

async function main() {
  env();
  await ensureSettings(); // follows /admin changes live (LISTEN neuron_settings + 5 s poll)
  await ensureNetwork(pool());
  const listener = await pool().connect();
  let wake: (() => void) | null = null;
  listener.on("notification", () => wake?.());
  await listener.query("listen neuron_jobs");
  let lastHousekeeping = 0;
  log.info("worker_started", { worker: WORKER_ID, kinds: KINDS, concurrency: MAX_CONCURRENT });
  while (!stopping) {
    if (Date.now() - lastHousekeeping > 10_000) {
      lastHousekeeping = Date.now();
      const stale = await requeueStale(pool()).catch(() => []);
      if (stale.length) log.warn("jobs_requeued", { count: stale.length });
      await pool().query("delete from jobs where kind = 'index_registry'").catch(() => {});
    }
    let took = false;
    if (running < MAX_CONCURRENT) took = await runOne().catch((e) => { log.error("claim_failed", { error: (e as Error).message }); return false; });
    if (!took) await new Promise<void>((r) => { wake = r; setTimeout(r, 1000); });
    wake = null;
  }
  while (running > 0) await new Promise((r) => setTimeout(r, 200));
  listener.release();
  await pool().end();
  log.info("worker_stopped", { worker: WORKER_ID });
}

for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { stopping = true; });
main().catch((e) => { log.error("worker_crashed", { error: (e as Error).message }); process.exit(1); });
void one;

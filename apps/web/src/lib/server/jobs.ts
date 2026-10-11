import { one, q, type Db } from "./db";

export type JobKind = "experiment" | "training" | "index_registry" | "reconcile_payment" | "governance_execute";

export async function enqueue(db: Db, kind: JobKind, payload: Record<string, unknown>, opts: { idempotencyKey?: string; maxAttempts?: number; runAfter?: Date } = {}) {
  const row = await one<{ id: string }>(
    `insert into jobs (kind, payload, idempotency_key, max_attempts, run_after) values ($1,$2,$3,$4,coalesce($5, now()))
     on conflict (idempotency_key) do update set idempotency_key = excluded.idempotency_key
     returning id`, [kind, payload, opts.idempotencyKey ?? null, opts.maxAttempts ?? 3, opts.runAfter ?? null], db);
  await db.query("select pg_notify('neuron_jobs', $1)", [kind]);
  return row!.id;
}

/** Claim one ready job with SKIP LOCKED so concurrent workers never take the same job. */
export async function claim(db: Db, workerId: string, kinds: JobKind[]) {
  return one<{ id: string; kind: JobKind; payload: Record<string, unknown>; attempts: number; max_attempts: number }>(
    `update jobs set status = 'running', locked_by = $1, locked_at = now(), heartbeat_at = now(), attempts = attempts + 1, updated_at = now()
      where id = (
        select id from jobs where status = 'queued' and run_after <= now() and kind = any($2::text[])
        order by run_after, created_at for update skip locked limit 1)
      returning id, kind, payload, attempts, max_attempts`, [workerId, kinds], db);
}

export async function complete(db: Db, id: string, result: unknown) {
  await q("update jobs set status = 'completed', result = $2, updated_at = now(), locked_by = null where id = $1", [id, result ?? null], db);
}

/** Retry with exponential backoff; after max attempts the job is dead-lettered. */
export async function fail(db: Db, id: string, error: string, retryable: boolean) {
  const j = await one<{ attempts: number; max_attempts: number }>("select attempts, max_attempts from jobs where id = $1", [id], db);
  const dead = !retryable || !j || j.attempts >= j.max_attempts;
  const delay = Math.min(300, 2 ** (j?.attempts ?? 1) * 2);
  await q(`update jobs set status = $2, last_error = $3, run_after = now() + make_interval(secs => $4), locked_by = null, updated_at = now() where id = $1`,
    [id, dead ? "dead" : "queued", error.slice(0, 2000), delay], db);
  return dead;
}

/** Jobs whose worker died (no heartbeat) go back to the queue. */
export async function requeueStale(db: Db, staleSec = 60) {
  return q<{ id: string }>(
    `update jobs set status = 'queued', locked_by = null, updated_at = now()
      where status = 'running' and heartbeat_at < now() - make_interval(secs => $1) returning id`, [staleSec], db);
}

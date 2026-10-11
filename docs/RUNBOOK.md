# Operations runbook

## Health
- `GET /api/health` — liveness. `GET /api/ready` — DB migrated + RPC slot/latency (503 if DB down).
- `GET /api/metrics` and the `/ops` page — queue depth by kind/status, experiment p50/p95, failures (1 h), dead jobs, payment backlog, training CPU, RPC latency, indexer slot lag, pending commitments, SSE connections, and active alerts.

## Alert thresholds (built into `/api/metrics`)
| alert | threshold | first action |
| --- | --- | --- |
| queue depth | > 100 queued | scale workers (`WORKER_CONCURRENCY`, more processes) |
| dead jobs | > 0 | inspect `jobs.last_error`; requeue with `update jobs set status='queued', attempts=0 where id=…` after fixing cause |
| stale payments | submitted > 10 min | check RPC; reconcile jobs retry with backoff up to 12 times |
| RPC | unreachable or > 2 s | switch `SOLANA_RPC` to a backup provider |
| experiment p95 | > 500 ms | check host load; models are capped so this indicates contention |

## Safe restart
Workers are stateless. `SIGTERM` stops claiming and waits for in-flight jobs. A crashed worker's jobs are requeued after 60 s without heartbeat. Training restarts from the job start (checkpoints already written are kept; resumable via pause/resume).

## Backups
- Postgres: `pg_dump -Fc neuron > neuron-$(date +%F).dump` daily; keep 30 days; test restore monthly into a scratch DB and run `npx vitest run` against it.
- Artifact store: immutable, content-addressed — replicate the bucket/dir; integrity is self-verifying (re-hash on read via `importModel`).
- Retention: `activity_events` and finished `index_registry` jobs can be pruned (> 30 days / > 1 hour); keep `credit_events`, `token_payments`, `commitments` forever.

## Recovery
- Validator reset (localnet): run `npm run localnet -- --reset`, then re-run `scripts/localnet-setup.ts` (new mint) and update env.
- Indexer cursor lost/pruned: handled automatically (rescans the recent window; updates are idempotent by PDA).

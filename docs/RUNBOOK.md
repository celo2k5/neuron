# Operations runbook

## Health
- `GET /api/health` — liveness. `GET /api/ready` — DB reachable and migrated (503 if not).
- `GET /api/metrics` and the `/ops` page — queue depth by kind/status, experiment p50/p95, failures (1 h), dead jobs, training CPU, registry length/head/integrity, daily claims, SSE connections, and active alerts.

## Alert thresholds (built into `/api/metrics`)
| alert | threshold | first action |
| --- | --- | --- |
| queue depth | > 100 queued | scale workers (`WORKER_CONCURRENCY`, more processes) |
| dead jobs | > 0 | inspect `jobs.last_error`; requeue with `update jobs set status='queued', attempts=0 where id=…` after fixing cause |
| registry chain broken | any | stop writes, compare `registry_entries` with the last backup from the reported `seq`; restore from backup |
| experiment p95 | > 500 ms | check host load; models are capped so this indicates contention |

## Safe restart
Workers are stateless. `SIGTERM` stops claiming and waits for in-flight jobs. A crashed worker's jobs are requeued after 60 s without heartbeat. Training restarts from the job start (checkpoints already written are kept; resumable via pause/resume).

## Backups
- Postgres: `pg_dump -Fc neuron > neuron-$(date +%F).dump` daily; keep 30 days; test restore monthly into a scratch DB and run `npx vitest run` against it.
- Artifact store: immutable, content-addressed — replicate the bucket/dir; integrity is self-verifying (re-hash on read via `importModel`).
- Retention: `activity_events` can be pruned (> 30 days); keep `credit_events`, `registry_entries`, `registry_keys` forever. Back up `REGISTRY_SIGNING_KEY` with your other secrets.

## Key rotation
Set a new `REGISTRY_SIGNING_KEY` and restart. New entries are signed with the new key id; old entries keep verifying against their recorded key in `registry_keys`.

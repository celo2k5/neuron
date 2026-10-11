# Architecture

```mermaid
flowchart LR
  subgraph Browser
    UI[Next.js UI<br/>React + TanStack Query]
    R[Canvas renderer<br/>outside React]
    TW[Web Worker<br/>training preview]
    E1[@neuron/engine]
    WAL[Wallet Standard / dev wallet]
  end
  subgraph Server
    API[Next route handlers<br/>Zod · error envelope · rate limits]
    SSE[/SSE /api/events/]
    W[Worker process<br/>Postgres queue, SKIP LOCKED]
    T[Training thread<br/>worker_threads, 256 MB, wall-clock cap]
    E2[@neuron/engine]
  end
  PG[(PostgreSQL<br/>metadata + ledgers)]
  OBJ[(Artifact store<br/>content-addressed)]
  SOL[(Solana<br/>neuron_registry + SPL $NEURON)]

  UI --> API
  UI <-- events --> SSE
  UI --> R
  UI --> TW
  E1 -. same code .- E2
  WAL -- sign challenge / tx --> SOL
  API --> PG
  API --> OBJ
  API -- read mint, build txs --> SOL
  W --> PG
  W --> OBJ
  W --> T
  W -- reconcile payments, index commits --> SOL
  SSE --> PG
```

## Packages

| path | role |
| --- | --- |
| `packages/engine` | Deterministic generator, matrix inference, backprop, SGD/Adam, datasets, canonical encoding + SHA-256, community-network compiler. Pure TS, no I/O. |
| `packages/viz` | Graph extraction, six deterministic layouts, seed palettes, propagation schedule. Never mutates a model. |
| `packages/solana` | Registry instruction builders/decoders, PDA derivation, SIWS-style challenges, payment tx builder and independent payment inspection. |
| `programs/neuron_registry` | Anchor program: `initialize`, `set_paused`, `commit_experiment`. |
| `apps/web` | Next.js app (UI + API), worker, migrations, localnet bootstrap, E2E and integration tests. |

## Data flow of an experiment

1. Client posts `{modelId, version, input}`. API loads the pinned version **from the artifact store**, re-validates both hashes, validates the input, writes `experiments(queued)` + a `jobs` row in one transaction (credits reserved if beyond the free tier).
2. Worker claims the job (`FOR UPDATE SKIP LOCKED`), runs the engine, stores the full activation trace as an artifact, writes output, summaries, result/metadata hashes, settles credits, emits `experiment.completed`.
3. SSE pushes the event id; clients refetch the experiment (events are hints, never state).
4. Optionally the owner commits `(result, artifact, metadata)` hashes to a PDA; the indexer and `PUT /api/commitments/:id` match it by PDA and verify.

## Why a Postgres queue instead of Redis/BullMQ

The spec allows "another durable queue". Postgres gives transactional enqueue (job row is created in the same transaction as the experiment/training row and the credit reservation), `SKIP LOCKED` claiming, idempotency keys, backoff, dead-lettering and stale-heartbeat recovery with one fewer service to operate. Redis is not required.

## Realtime

`activity_events.id` is a `bigserial` cursor. `/api/events` streams rows with `id:` set, so `EventSource` resumes with `Last-Event-ID` and never replays. On (re)connect the client invalidates all queries and refetches authoritative snapshots.

# NEURON — One Token. Infinite Connections.

A Solana-powered laboratory for neural computation you can see and check. Generate deterministic neural models from seeds, run real inference, watch activations propagate along the actual graph, train small models, register neurons into a shared community network, and commit reproducible experiment hashes to Solana.

Generated models are computational structures, not trained intelligence. A matching on-chain commitment proves what was recorded and when, not that the arithmetic was correct.

## Repository

| path | what |
| --- | --- |
| `packages/engine` | Seeded generator (feed-forward, sparse, residual), matrix inference, backprop, SGD/Adam, datasets, canonical encoding + SHA-256, community-network compiler |
| `packages/viz` | Graph extraction, six layout algorithms (CONSTELLATION, CORTEX, CIRCUIT, FRACTAL, SYNAPSE, MINIMAL), seed palettes |
| `packages/solana` | Registry client, SIWS-style challenges, payment builder + independent on-chain payment inspection |
| `programs/neuron_registry` | Anchor experiment-commitment program |
| `apps/web` | Next.js 15 + React 19 + Tailwind 4 + TanStack Query UI and API, Postgres-queue worker, migrations, tests |
| `infra` | One-command localnet (Postgres + validator + registry + test mint), dev worker, Dockerfiles |
| `docs` | Architecture, encoding/math, program, security, runbook, OpenAPI |

## Run it locally

Requirements: Node ≥ 20.11, PostgreSQL 16 binaries, Rust + Solana CLI (Agave) with `cargo build-sbf`.

```bash
npm install
npm run localnet            # Postgres :5433, solana-test-validator :8899 with the program, registry init,
                            # TEST $NEURON mint + treasury → writes infra/.localnet/app.env
cp infra/.localnet/app.env apps/web/.env.local
echo "APP_DOMAIN=localhost:3000" >> apps/web/.env.local
echo "APP_URL=http://localhost:3000" >> apps/web/.env.local
npm run db:seed             # 12 genesis specimens for the gallery
npm run build && npm run start -w @neuron/web    # or: npm run dev
npm run worker              # second terminal
```

Open http://localhost:3000. On localnet the wallet menu offers a clearly labelled **dev wallet** (browser burner key) plus localnet airdrop / test-token faucet; Phantom, Solflare, Backpack and other Wallet Standard wallets are detected automatically.

`docker-compose.yml` describes the same stack, but it was **not executed** in the build environment (no Docker daemon). `infra/localnet.sh` is the verified path.

## Commands

```bash
npm run typecheck      # tsc across engine, viz, solana, web
npm run lint           # eslint (next/core-web-vitals + typescript)
npm test               # unit (engine, viz, solana) + integration (web, real Postgres)
npm run test:program   # builds the program, boots a throwaway validator, runs program + payment tests
npm run test:e2e       # Playwright against the running stack (desktop + mobile)
npm run build          # production build
```

## Verification (this build, localnet)

Run on 2026-10-11 in the build workspace: Node 22.22, PostgreSQL local cluster, Agave 4.3.0 `solana-test-validator`, Chromium headless.

| check | result |
| --- | --- |
| `npm run typecheck` | pass (4 packages) |
| `npm run lint` | pass, 0 warnings |
| engine unit tests | 25 / 25 — canonical encoding, PRNG, determinism, distinct seeds/topologies, sparse masks, residual skips, size limits, matVec + hand fixture, activations/softmax reference values, independent reference forward on every architecture × activation, input validation, result hashes, export/import tamper detection, finite-difference gradient checks, Adam learns XOR (> 90% val acc), deterministic SGD, rejected jobs |
| viz unit tests | 4 / 4 — one edge per real connection, layouts deterministic, form switch never changes hash/output, seed palettes, schedule order |
| solana unit tests | 5 / 5 — challenge round-trip + ed25519, tamper rejection, exact integer token math, id domain separation |
| program tests (`test:program`) | 12 / 12 — init once, commit/decode/verify, duplicate commit, PDA + registry substitution, zero hash, missing signer, authority-only pause, real SPL payment verified + 4 tampered intents rejected |
| web integration tests | 13 / 13 on real Postgres — auth replay / wrong signer / domain / cluster / expiry / intent, idempotent credits + no overdraft, one signature ↔ one intent, queue idempotency + no double-claim + backoff + dead-letter + stale recovery, artifact path traversal, keyset pagination, experiment = engine result, free-tier → credit charging, dataset mismatch, community payload-bound signatures + cross-user edit blocked, monotonic event cursor |
| `npm run build` | pass |
| Playwright E2E | 12 / 12 against the production build (below) |

E2E acceptance criteria (spec §28), all through the real UI → API → Postgres → worker → validator:

1. app loads, hero runs live inference — **pass**
2. same seed + config reproduces the same artifact hash after reload — **pass**
3. a different seed gives a different topology and hash — **pass**
4. inference output in the browser equals the server worker's output digit-for-digit; reproduce reports bit-identical — **pass**
5. graph animation is driven by the computed activation trace (pulse strength = |w·a|, layer order) — covered by viz tests + E2E inspection
6. server training job lowers validation loss vs. baseline, writes immutable checkpoints, checkpoint loads as a trained version — **pass**
7. wallet sign-in with a signed, single-use challenge — **pass** (dev wallet on localnet)
8. buy credits with local-validator test $NEURON; intent reconciled once; balance 1000 → 990 — **pass**
9. commit an experiment on-chain and verify it — **pass**
10. models, versions and history survive reload and a server + worker restart — **pass**

Real localnet signatures from the run (localnet only, not on any public cluster):
- commitment: `mCcJzCiLF2RkwC5Qq6nwxLQMPQ14spUL5VxD8R3LgxHE6292ZQNo1FvQUvGWZmhEcMP7MQX9pFhJhieHctHDDfv` (slot 4991)
- payment: `2CGQkuSQ51eyoKVNZDuUABKAGA2wUHco4wXExzLjCTNpA6Sk3761mb951M5mrJgqTBUXJB5ZttC3Yq4tk37ndqJz` (slot 3163)
- program id (localnet): `BJmJe2GxxiTMiyrioiDrsM3RdUmRddA6TJQiFs6RoPDX`

## Not done / blocked

| item | status | what is needed |
| --- | --- | --- |
| devnet deployment | not attempted | a funded devnet keypair, explicit go-ahead, a fresh program keypair; then set `REGISTRY_PROGRAM_ID`, `NEURON_MINT` (existing), `TREASURY_OWNER` |
| mainnet | preparatory only; the app refuses `mainnet-beta` unless `ALLOW_MAINNET=yes` | audit, multisig upgrade authority, explicit approval |
| `$NEURON` mint | none configured; localnet creates a worthless TEST mint | the real mint address (never invented or replaced) |
| real browser-extension wallet E2E | not run (headless CI) | manual test with Phantom/Solflare; the dev wallet exercises the same sign/send paths |
| Docker Compose | written, not executed | a Docker daemon |
| Recurrent / modular architectures | intentionally not offered | execution + validation not implemented (spec §6) |
| Historical-snapshot governance weight | weight = balance at vote time (documented) | a balance-snapshot indexer |
| Premium model storage tier | not built; storage is free | pricing decision |
| Object storage | filesystem adapter | S3/GCS adapter for production |
| GetLayers | not used | no GetLayers connector is available in this workspace |

See `docs/SECURITY.md` for trust assumptions and remaining audit risks.

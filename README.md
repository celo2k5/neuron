# NEURON — One Token. Infinite Connections.

A laboratory for neural computation you can see and check. Generate deterministic neural models from seeds, run real inference, watch activations propagate along the actual graph, train small models, register neurons into a shared community network, and record reproducible experiment hashes in a signed, tamper-evident registry.

Everything runs on the server: there is no on-chain program and no blockchain is required. Wallets are used only to sign in and to sign governance votes (free, off-chain messages). Generated models are computational structures, not trained intelligence. A verified registry entry shows what was recorded and when, not that the arithmetic was correct.

## Repository

| path | what |
| --- | --- |
| `packages/engine` | Seeded generator (feed-forward, sparse, residual), matrix inference, backprop, SGD/Adam, datasets, canonical encoding + SHA-256, community-network compiler |
| `packages/viz` | Graph extraction, six layout algorithms (CONSTELLATION, CORTEX, CIRCUIT, FRACTAL, SYNAPSE, MINIMAL), seed palettes |
| `packages/solana` | SIWS-style wallet sign-in challenges; optional `$NEURON` payment builder + inspection (unused unless a mint is configured) |
| `apps/web` | Next.js 15 + React 19 + Tailwind 4 + TanStack Query UI and API, server registry, credits, governance, Postgres-queue worker, migrations, tests |
| `infra` | One-command local Postgres, dev worker, Dockerfiles |
| `docs` | Architecture, encoding/math, security, runbook, launch, OpenAPI |

## Quick preview (any OS, no Docker or system Postgres)

```bash
npm install
npm run preview        # embedded PostgreSQL + Next dev server + worker → http://localhost:3000
```
On Windows you can double-click `start-preview.cmd`. Everything works in the preview: generation, the lab, inference, training, the gallery, experiments, the registry, daily credits, governance, the community network and dev-wallet sign-in.

## Run the full stack locally

Requirements: Node ≥ 20.11 and PostgreSQL 16 binaries.

```bash
npm install
npm run localnet            # Postgres :5433 + migrations → writes infra/.localnet/app.env
cp infra/.localnet/app.env apps/web/.env.local
echo "APP_DOMAIN=localhost:3000" >> apps/web/.env.local
echo "APP_URL=http://localhost:3000" >> apps/web/.env.local
npm run db:seed             # 12 genesis specimens for the gallery
npm run build && npm run start -w @neuron/web    # or: npm run dev
npm run worker              # second terminal
```

Open http://localhost:3000. With `SOLANA_CLUSTER=localnet` the wallet menu offers a clearly labelled **dev wallet** (browser burner key) for testing; Phantom, Solflare, Backpack and other Wallet Standard wallets are detected automatically. No validator or RPC is needed.

`docker-compose.yml` describes the same stack, but it was **not executed** in the build environment (no Docker daemon). `infra/localnet.sh` is the verified path.

## Admin

`/admin` is the control room for everything that has to be set to run on mainnet. Admins are the wallets in `ADMIN_WALLETS`. Settings live in `app_settings`, override the matching environment variables, and reach every process within a second (Postgres `LISTEN/NOTIFY`, with a 5 s poll as backup) and every open browser through the event stream. Mainnet is switched on only by the go-live action, after every required readiness check passes.

## Server registry

Recording an experiment appends `(seq, experiment, owner, result/artifact/metadata hashes, prev_hash, key, time)` to `registry_entries`. The entry hash covers all of it, including the previous entry's hash, and is signed with the server's ed25519 key (`REGISTRY_SIGNING_KEY`, or one generated once and kept in `registry_keys`). A trigger refuses updates and deletes. `GET /api/commitments/:id` re-checks one entry; `GET /api/ledger` re-walks the whole chain and publishes the head hash and the public key(s).

## Commands

```bash
npm run typecheck      # tsc across engine, viz, solana, web
npm run lint           # eslint (next/core-web-vitals + typescript)
npm test               # unit (engine, viz, solana) + integration (web, real Postgres)
npm run test:e2e       # Playwright against the running stack (desktop + mobile)
npm run build          # production build
```

## Verification (server-only build)

Run on 2026-10-12 in the build workspace: Node 22.22, local PostgreSQL 16, Chromium headless, no validator or RPC running.

| check | result |
| --- | --- |
| `npm run typecheck`, `npm run lint` | pass, 0 warnings |
| web integration tests (real Postgres) | 17 / 17, including: registry entries signed + chained + idempotent, owner-only, updates/deletes refused by trigger, tampered experiment detected as mismatch, full-chain walk; daily claim once per day; one-wallet-one-vote governance with replay and double-vote refused |
| solana package unit tests | 3 / 3 (sign-in challenges, token amount math) |
| `npm run build` | pass |
| Playwright E2E | 12 / 12 against the production build: deterministic generation, browser output = server output, reproduce, sign-in, daily credit claim, community registration, server training, registry record + verify + chain integrity, persistence, mobile layout, reduced motion |

## Not done / optional

| item | status |
| --- | --- |
| `$NEURON` token | optional and off. Setting `NEURON_MINT` + `TREASURY_OWNER` turns on buying credits with the token and token-weighted governance; nothing else depends on it |
| real browser-extension wallet E2E | not run (headless); the dev wallet exercises the same sign-in path |
| Docker Compose | written, not executed |
| Recurrent / modular architectures | intentionally not offered |
| Premium model storage tier | not built; storage is free |
| External anchoring of the registry head | not built; publishing the head hash somewhere public (or a timestamping service) would make rewrites detectable without trusting the operator |

See `docs/SECURITY.md` for trust assumptions and remaining audit risks.

# Mainnet launch checklist

Nothing here runs against mainnet automatically. The app refuses `mainnet-beta` unless `ALLOW_MAINNET=yes`, never creates a token outside localnet, and every mainnet step that spends SOL or uses a key is done by the owner's wallet.

## 1. Devnet rehearsal (free)

- [ ] Fund the devnet deployer with ~2.5 devnet SOL at https://faucet.solana.com (address printed by `bash infra/devnet.sh`)
- [ ] `bash infra/devnet.sh`: builds the program with a fresh devnet id, deploys it, initialises the registry, creates a TEST mint and treasury, funds a rehearsal user, writes `infra/.devnet/app.env`
- [ ] Start the app and worker with `infra/.devnet/app.env` (`SOLANA_CLUSTER=devnet`, `SOLANA_FINALITY=finalized`)
- [ ] `APP_URL=http://localhost:3000 npx tsx scripts/devnet-rehearsal.ts` (in `apps/web`): sign-in → buy credits → experiment → commit → verify
- [ ] Repeat once in a browser with Phantom or Solflare switched to devnet

Keys live in `infra/.devnet/` (git-ignored, devnet only). Never reuse them on mainnet.

## 2. Close the gaps in `docs/SECURITY.md`

- [ ] External audit of `programs/neuron_registry` and the payment verification (`apps/web/src/lib/server/payments.ts`, `packages/solana/src/payments.ts`)
- [ ] Program upgrade authority → multisig (e.g. Squads), or revoked
- [ ] Treasury owner → multisig
- [ ] Governance weight: add balance snapshots, or launch governance as advisory only
- [ ] Artifact store → object storage with versioning and backups
- [ ] CDN / WAF in front of the app

## 3. Token (owner's wallet)

- [ ] Decide decimals (the app assumes 6), supply and distribution
- [ ] Create the mint with **no freeze authority**; lock or burn the mint authority after the initial mint
- [ ] Add token metadata (name, symbol, logo)
- [ ] Legal review of how the token and credits are sold and described

## 4. Program (owner's wallet)

- [ ] New mainnet program keypair; build with that id (same approach as `infra/devnet.sh`)
- [ ] Deploy (~1 SOL stays as program rent; the deploy briefly needs ~2 SOL plus fees)
- [ ] Initialise the registry with a dedicated admin key (it can only pause new commits)
- [ ] Move the upgrade authority to the multisig

## 5. Hosting

- [ ] Next.js app + worker + managed Postgres (Render, Fly, or similar); run migrations
- [ ] Paid RPC (Helius, Triton, QuickNode)
- [ ] Production env:
  `SOLANA_CLUSTER=mainnet-beta` · `ALLOW_MAINNET=yes` · `SOLANA_FINALITY=finalized` ·
  `REGISTRY_PROGRAM_ID` · `NEURON_MINT` · `TREASURY_OWNER` · `APP_DOMAIN` / `APP_URL` (real domain) ·
  `DEV_MINT_AUTHORITY_KEYPAIR` empty
- [ ] Monitoring: `/api/health`, `/api/ready`, `/api/metrics`; database backups

## 6. Soft launch

- [ ] One small real credit purchase and one commit by the team; check both on an explorer
- [ ] Publish the mint address only after it exists and is verified
- [ ] Announce

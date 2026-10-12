# Launch checklist

NEURON runs entirely on the server: registry, credits, governance, training and the community network all live in Postgres. There is no on-chain program to deploy and nothing here spends SOL.

## 1. Hosting (Render)

- [x] Web service `neuron` on Render (free plan, Virginia), app + worker in one instance via `apps/web/scripts/start-all.sh`
- [x] `ARTIFACT_STORE=db`, `DB_SCHEMA=neuron`, `DB_POOL_MAX=4`, `APP_DOMAIN=neuronai.online`, `APP_URL=https://neuronai.online`
- [x] Custom domain `neuronai.online` (www redirects to it); Porkbun ALIAS + www CNAME → `neuron-oijh.onrender.com`
- [ ] `DATABASE_URL` = the Postgres **Internal Database URL** (owner adds it in Render → Environment)
- [ ] `REGISTRY_SIGNING_KEY` = 64 hex chars from `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`, kept only in Render's environment and a password manager. Optional: without it a key is generated and stored in the database.
- [ ] Optional: `DAILY_CLAIM_CREDITS` (default 10), `FREE_EXPERIMENTS_PER_DAY` (25), `GOV_QUORUM_VOTERS` (3)

## 2. Before real traffic

- [ ] The shared free Postgres expires on 2026-10-27: move to a paid or dedicated database and restore a dump before then
- [ ] Free web instances sleep after 15 idle minutes (slow first request) and the worker sleeps with it: a paid instance keeps both awake
- [ ] Daily `pg_dump` backups (see `RUNBOOK.md`)
- [ ] Monitoring on `/api/health`, `/api/ready`, `/api/metrics` (alerts include a broken registry chain)
- [ ] CDN / WAF in front for abuse protection

## 3. Optional later

- [ ] Publish the registry head hash somewhere public on a schedule, so rewrites are detectable without trusting the operator
- [ ] A `$NEURON` token: setting `NEURON_MINT` + `TREASURY_OWNER` enables buying credits with it and token-weighted governance. Nothing else needs it.

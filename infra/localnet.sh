#!/usr/bin/env bash
# One-command local stack without Docker: Postgres (infra/dev-postgres.sh) + migrations.
# Everything runs on the server; there is no validator or on-chain program to start.
# SOLANA_CLUSTER=localnet only enables the browser dev wallet for local testing.
# Usage: bash infra/localnet.sh
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
STATE="$ROOT/infra/.localnet"; mkdir -p "$STATE"
DB_URL=$("$ROOT/infra/dev-postgres.sh" start)
cd "$ROOT/apps/web"
DATABASE_URL="$DB_URL" npx tsx scripts/migrate.ts
printf 'DATABASE_URL=%s\nSOLANA_CLUSTER=localnet\n' "$DB_URL" > "$STATE/app.env"
echo "local stack ready → env written to infra/.localnet/app.env"
cat "$STATE/app.env"

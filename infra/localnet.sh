#!/usr/bin/env bash
# One-command local stack without Docker:
#   Postgres (infra/dev-postgres.sh) + solana-test-validator with the registry program
#   + registry init + TEST $NEURON mint, then migrations. Prints the env to use.
# Usage: bash infra/localnet.sh [--reset]
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
STATE="$ROOT/infra/.localnet"; mkdir -p "$STATE"
PROGRAM_DIR="$ROOT/programs/neuron_registry"
PROGRAM_ID=$(solana-keygen pubkey "$PROGRAM_DIR/localnet-program-keypair.json")
[ -f "$PROGRAM_DIR/target/deploy/neuron_registry.so" ] || (cd "$PROGRAM_DIR" && cargo build-sbf)

DB_URL=$("$ROOT/infra/dev-postgres.sh" start)

if ! solana -u http://127.0.0.1:8899 cluster-version >/dev/null 2>&1; then
  RESET=""; [ "${1:-}" = "--reset" ] && RESET="--reset" && rm -f "$STATE/mint.txt"
  nohup solana-test-validator $RESET --quiet --ledger "$STATE/ledger" --limit-ledger-size 50000000 \
    --bpf-program "$PROGRAM_ID" "$PROGRAM_DIR/target/deploy/neuron_registry.so" > "$STATE/validator.log" 2>&1 &
  echo $! > "$STATE/validator.pid"
  for i in $(seq 1 60); do solana -u http://127.0.0.1:8899 cluster-version >/dev/null 2>&1 && break; sleep 1; done
fi

cd "$ROOT/apps/web"
DATABASE_URL="$DB_URL" npx tsx scripts/migrate.ts
REGISTRY_PROGRAM_ID="$PROGRAM_ID" LOCALNET_DIR="$STATE" npx tsx scripts/localnet-setup.ts >/dev/null
{ echo "DATABASE_URL=$DB_URL"; cat "$STATE/env"; } > "$STATE/app.env"
echo "localnet ready → env written to infra/.localnet/app.env"
cat "$STATE/app.env"

#!/usr/bin/env bash
# Builds the program, boots a throwaway solana-test-validator with it loaded,
# and runs the TypeScript program tests against it.
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
PROGRAM_ID=$(solana-keygen pubkey localnet-program-keypair.json)
cargo build-sbf >/dev/null
LEDGER=$(mktemp -d)
PORT=${TEST_RPC_PORT:-8919}
solana-test-validator --reset --quiet --ledger "$LEDGER" --rpc-port "$PORT" --faucet-port $((PORT + 10)) \
  --gossip-port $((PORT + 20)) --dynamic-port-range $((PORT + 30))-$((PORT + 60)) \
  --bpf-program "$PROGRAM_ID" target/deploy/neuron_registry.so >/dev/null 2>&1 &
VPID=$!
trap 'kill $VPID 2>/dev/null || true; rm -rf "$LEDGER"' EXIT
for i in $(seq 1 60); do
  solana -u "http://127.0.0.1:$PORT" cluster-version >/dev/null 2>&1 && break
  sleep 1
  [ "$i" = 60 ] && { echo "test validator failed to start" >&2; exit 1; }
done
SOLANA_RPC="http://127.0.0.1:$PORT" REGISTRY_PROGRAM_ID="$PROGRAM_ID" npx --prefix ../../packages/solana vitest run --root ../../packages/solana

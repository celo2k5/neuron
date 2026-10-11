#!/usr/bin/env bash
# Devnet rehearsal of the mainnet launch (no real funds: devnet SOL only).
#   1. builds neuron_registry with the devnet program id (a fresh keypair, never the localnet one)
#   2. deploys it with infra/.devnet/deployer.json (fund it first: https://faucet.solana.com)
#   3. initialises the registry, creates a TEST $NEURON mint + treasury, funds a rehearsal user
#   4. writes infra/.devnet/app.env for the web app and worker
# Usage: bash infra/devnet.sh            (idempotent; re-running skips finished steps)
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
RPC=${DEVNET_RPC:-https://api.devnet.solana.com}
case "$RPC" in *devnet*) ;; *) echo "refusing: $RPC is not a devnet RPC"; exit 1;; esac
DIR="$ROOT/infra/.devnet"; mkdir -p "$DIR"; chmod 700 "$DIR"
for k in deployer program treasury user; do
  [ -f "$DIR/$k.json" ] || solana-keygen new -s --no-bip39-passphrase -o "$DIR/$k.json" >/dev/null
done
DEPLOYER=$(solana-keygen pubkey "$DIR/deployer.json"); PROGRAM_ID=$(solana-keygen pubkey "$DIR/program.json")
echo "deployer $DEPLOYER   program $PROGRAM_ID"
BAL=$(solana -u "$RPC" balance "$DEPLOYER" | awk '{print $1}')
echo "deployer balance: $BAL SOL"
awk "BEGIN{exit !($BAL < 2.2)}" && { echo "need ~2.5 SOL on the deployer (the deploy briefly holds ~2 SOL of rent in a buffer, ~1 SOL stays as program rent). Fund $DEPLOYER at https://faucet.solana.com (devnet) and re-run."; exit 2; }

# 1. build with the devnet id (the source tree keeps the localnet id)
SO="$DIR/neuron_registry.so"
if [ ! -f "$SO" ]; then
  B=$(mktemp -d); cp -r "$ROOT/programs/neuron_registry/"{Cargo.toml,Cargo.lock,src} "$B/"
  sed -i "s/declare_id!(\"[1-9A-HJ-NP-Za-km-z]*\")/declare_id!(\"$PROGRAM_ID\")/" "$B/src/lib.rs"
  grep -q "$PROGRAM_ID" "$B/src/lib.rs" || { echo "declare_id patch failed"; exit 1; }
  (cd "$B" && CARGO_TARGET_DIR="$ROOT/programs/neuron_registry/target-devnet" cargo build-sbf >/dev/null)
  cp "$ROOT/programs/neuron_registry/target-devnet/deploy/neuron_registry.so" "$SO"
fi

# 2. deploy (upgrade authority = deployer; on mainnet this must move to a multisig)
if ! solana -u "$RPC" program show "$PROGRAM_ID" >/dev/null 2>&1; then
  solana -u "$RPC" program deploy "$SO" --program-id "$DIR/program.json" --keypair "$DIR/deployer.json" --upgrade-authority "$DIR/deployer.json" --with-compute-unit-price 1000
fi
solana -u "$RPC" program show "$PROGRAM_ID"

# 3. registry, test mint, treasury, rehearsal user
cd "$ROOT/apps/web"
SOLANA_RPC="$RPC" REGISTRY_PROGRAM_ID="$PROGRAM_ID" DEVNET_DIR="$DIR" npx tsx scripts/devnet-setup.ts
echo "env written to infra/.devnet/app.env"

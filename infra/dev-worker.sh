#!/usr/bin/env bash
# Starts the job worker in the background with apps/web/.env.local; logs to /tmp/neuron-worker.log
set -euo pipefail
cd "$(dirname "$0")/../apps/web"
set -a; . ./.env.local; set +a
export NEURON_LOG=${NEURON_LOG_WORKER:-info}
nohup npx tsx scripts/worker.ts > /tmp/neuron-worker.log 2>&1 &
echo $! > /tmp/neuron-worker.pid
echo "worker pid $(cat /tmp/neuron-worker.pid)"

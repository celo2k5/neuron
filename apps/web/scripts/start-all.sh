#!/usr/bin/env bash
# Single-instance production start (e.g. Render free tier): migrate, seed the genesis
# gallery once, run the job worker in the background, and serve the app on $PORT.
set -euo pipefail
cd "$(dirname "$0")/.."
npx tsx scripts/migrate.ts
if [ "${SEED_ON_START:-yes}" = "yes" ]; then npx tsx scripts/seed.ts || echo "seed skipped"; fi
( while true; do npx tsx scripts/worker.ts || echo "worker exited ($?), restarting in 5s"; sleep 5; done ) &
exec npx next start -p "${PORT:-3000}"

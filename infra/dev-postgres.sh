#!/usr/bin/env bash
# Local Postgres for development/tests without Docker. Data lives in $PGDATA (default /tmp/neuron-pg).
# Usage: infra/dev-postgres.sh start|stop   (run as a non-root user, or as root: it re-execs as `nobody`)
set -euo pipefail
PGBIN=${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}
PGDATA=${PGDATA:-/tmp/neuron-pg}
PORT=${PGPORT:-5433}
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$PGDATA"; chown nobody "$PGDATA"
  exec runuser -u nobody -- env PGBIN="$PGBIN" PGDATA="$PGDATA" PGPORT="$PORT" bash "$0" "$@"
fi
case "${1:-start}" in
  start)
    [ -f "$PGDATA/PG_VERSION" ] || "$PGBIN/initdb" -D "$PGDATA" -U neuron --auth=trust >/dev/null
    "$PGBIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1 || "$PGBIN/pg_ctl" -D "$PGDATA" -o "-p $PORT -k /tmp" -l "$PGDATA/server.log" -w start >/dev/null
    "$PGBIN/psql" -h 127.0.0.1 -p "$PORT" -U neuron -d postgres -tc "select 1 from pg_database where datname='neuron'" | grep -q 1 \
      || "$PGBIN/psql" -h 127.0.0.1 -p "$PORT" -U neuron -d postgres -c "create database neuron" >/dev/null
    echo "postgres://neuron@127.0.0.1:$PORT/neuron"
    ;;
  stop) "$PGBIN/pg_ctl" -D "$PGDATA" -w stop >/dev/null && echo stopped ;;
esac

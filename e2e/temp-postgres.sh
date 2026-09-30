#!/bin/sh
# Throwaway PostgreSQL for the E2E suite (local machines / CI without a DB).
#   eval "$(sh e2e/temp-postgres.sh start)"   # prints the E2E_*_DATABASE_URL exports
#   sh e2e/temp-postgres.sh stop              # stops it and deletes the data dir
# Uses the first PostgreSQL found under /usr/lib/postgresql/*/bin (or PG_BIN).
set -eu
DIR="${E2E_PG_DIR:-${TMPDIR:-/tmp}/docknee-e2e-pg}"
PORT="${E2E_PG_PORT:-55433}"
PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
[ -x "$PG_BIN/initdb" ] || { echo "initdb not found; set PG_BIN" >&2; exit 1; }
as_pg() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/sh -c "$1"; else sh -c "$1"; fi; }
case "${1:-}" in
  start)
    mkdir -p "$DIR"; [ "$(id -u)" = 0 ] && chown postgres "$DIR"
    [ -f "$DIR/data/PG_VERSION" ] || as_pg "'$PG_BIN/initdb' -D '$DIR/data' -A trust -U postgres >/dev/null"
    as_pg "'$PG_BIN/pg_ctl' -D '$DIR/data' -o \"-p $PORT -k '$DIR' -c listen_addresses=127.0.0.1\" -l '$DIR/log' -w start >/dev/null"
    for db in docknee_e2e docregen_e2e; do
      psql -h 127.0.0.1 -p "$PORT" -U postgres -qAtc "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -q 1 \
        || psql -h 127.0.0.1 -p "$PORT" -U postgres -qc "CREATE DATABASE $db" >/dev/null
    done
    echo "export E2E_DOCKNEE_DATABASE_URL=postgres://postgres@127.0.0.1:$PORT/docknee_e2e"
    echo "export E2E_DOCREGEN_DATABASE_URL=postgres://postgres@127.0.0.1:$PORT/docregen_e2e"
    ;;
  stop)
    [ -d "$DIR/data" ] && as_pg "'$PG_BIN/pg_ctl' -D '$DIR/data' -m fast -w stop >/dev/null" || true
    rm -rf "$DIR"
    ;;
  *) echo "usage: $0 start|stop" >&2; exit 2 ;;
esac

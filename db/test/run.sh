#!/usr/bin/env bash
# Uso: PGURL=postgres://... ./db/test/run.sh   (banco DESCARTÁVEL)
set -euo pipefail
cd "$(dirname "$0")/../.."
psql "$PGURL" -v ON_ERROR_STOP=1 -q -f db/test/000_supabase_stub.sql
psql "$PGURL" -v ON_ERROR_STOP=1 -q -f db/migrations/001_docsholder_core.sql
psql "$PGURL" -v ON_ERROR_STOP=1 -q -f db/seeds/002_pathology_catalog.sql
psql "$PGURL" -v ON_ERROR_STOP=1 -q -f db/test/900_rls_tests.sql

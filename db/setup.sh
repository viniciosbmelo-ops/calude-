#!/usr/bin/env bash
# Aplica as migrações em ordem.
#   STANDALONE=1 DATABASE_URL=postgres://... ./db/setup.sh   → Postgres puro (cria roles/auth.uid() e tabela de pacientes)
#   DATABASE_URL=postgres://... ./db/setup.sh                → Supabase com patient/clinic_member já existentes
set -euo pipefail
cd "$(dirname "$0")/.."
: "${DATABASE_URL:?defina DATABASE_URL}"
run() { echo "→ $1"; psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$1"; }
if [ "${STANDALONE:-0}" = "1" ]; then
  run db/standalone/000_supabase_compat.sql
  run db/migrations/000_base_patient.sql
fi
run db/migrations/001_docsholder_core.sql
run db/seeds/002_pathology_catalog.sql
run db/migrations/003_api_support.sql
run db/migrations/004_app_features.sql
echo "OK"

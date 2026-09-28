#!/bin/bash
# post-merge.sh — DEVELOPMENT-ONLY post-merge setup.
#
# Replit's managed PostgreSQL forbids custom startup-time migration runners and
# startup DDL. Schema truth lives in Drizzle (lib/db/src/schema). This hook keeps
# the DEVELOPMENT database in sync after a merge:
#
#   1. Install dependencies with a frozen lockfile.
#   2. Apply the Drizzle schema to the *development* database via drizzle-kit
#      push. Uniqueness on populated response tables is represented as unique
#      indexes, avoiding drizzle-kit's destructive/truncation prompt.
#
# IMPORTANT:
#   • This runs ONLY against the development database. PRODUCTION schema changes
#     are applied through the Publish/Deploy schema diff, never by this script
#     and never at server startup.
#   • push-force is safe here ONLY because every table currently created ad-hoc
#     (retry/dedup, upload_grants, patient_verification_attempts and all regen_*
#     tables) is now fully modelled in the Drizzle schema. If a table were
#     missing from the schema, push would DROP it — so never enable this until
#     the schema is confirmed complete.
set -euo pipefail

# This hook is a development-only Replit lifecycle step. Refuse to turn it into
# an accidental deployment migration if it is ever invoked from another hook.
if [[ "${NODE_ENV:-}" == "production" || "${REPLIT_DEPLOYMENT:-}" == "1" ]]; then
  echo "Refusing to apply the development schema from a production environment." >&2
  exit 1
fi

# Post-merge runs with stdin closed. CI mode plus drizzle-kit's --force option
# makes both operations deterministic and non-interactive; push is idempotent.
export CI=true
pnpm install --frozen-lockfile
pnpm --filter @workspace/db run push-force </dev/null
echo "Development schema synced via drizzle-kit push. Production uses the Publish diff."

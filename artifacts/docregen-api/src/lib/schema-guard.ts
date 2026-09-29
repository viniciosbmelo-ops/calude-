import { pool } from "@workspace/docregen-db";
import { logger } from "./logger";

// ─────────────────────────────────────────────────────────────────────────────
// Read-only schema assertion
//
// Replit's managed PostgreSQL forbids startup-time DDL and custom production
// migration runners. DocRegen's schema truth lives in Drizzle
// (lib/docregen-db/src/schema) and is applied to DocRegen's OWN database via
// `pnpm --filter @workspace/docregen-db run push-force` (development, with
// DOCREGEN_DATABASE_URL) or the deploy schema diff (production).
//
// At boot we therefore ONLY verify — never mutate — that the critical tables and
// columns exist. If anything is missing we abort with an actionable message.
// No CREATE/ALTER is ever issued here.
// ─────────────────────────────────────────────────────────────────────────────

export interface RequiredColumn {
  table: string;
  column: string;
}

/** Tables that must exist before the server accepts traffic. */
export const REQUIRED_TABLES: string[] = [
  "doctors",
  "secretaries",
  "patients",
  "appointments",
  "stripe_webhook_events",
  "page_visits",
  "upload_grants",
  "storage_cleanup_jobs",
  "patient_verification_attempts",
  "patient_attachments",
  "pre_consult_questionnaires",
  "pre_consult_invites",
  "password_reset_tokens",
  "admin_contact_messages",
  "regen_products",
  "regen_conditions",
  "regen_terms_acceptance",
  "regen_cases",
  "regen_procedures",
  "regen_prom_responses",
  "regen_lab_results",
  "regen_ai_interactions",
  "regen_followup_notifications",
  "regen_scale_responses",
  "regen_schema_migrations",
  "whatsapp_outbox",
  "whatsapp_delivery_audit",
];

/**
 * Columns that are frequently added late and whose absence causes hard-to-debug
 * runtime failures. We assert a representative subset rather than every column;
 * the full column set is guaranteed by the schema-diff deploy step.
 */
export const REQUIRED_COLUMNS: RequiredColumn[] = [
  { table: "stripe_webhook_events", column: "stripe_event_id" },
  { table: "doctors", column: "estrangeiro" },
  { table: "doctors", column: "pais_origem" },
  { table: "doctors", column: "last_login_at" },
  { table: "doctors", column: "session_version" },
  { table: "secretaries", column: "session_version" },
  { table: "page_visits", column: "access_type" },
  { table: "page_visits", column: "country_code" },
  { table: "page_visits", column: "region_code" },
  // Patient verification lockout
  { table: "patient_verification_attempts", column: "key_hash" },
  { table: "patient_verification_attempts", column: "locked_until" },
  { table: "pre_consult_questionnaires", column: "patient_answers" },
  { table: "pre_consult_questionnaires", column: "current_answers" },
  { table: "pre_consult_invites", column: "token_hash" },
  { table: "patient_attachments", column: "pre_consult_questionnaire_id" },
  // Persistent, single-use password reset tokens.
  { table: "password_reset_tokens", column: "token_hash" },
  { table: "password_reset_tokens", column: "used_at" },
  { table: "password_reset_tokens", column: "expires_at" },
  // Regenerativa case planning fields — persisted by POST/PATCH /regen/cases.
  { table: "regen_cases", column: "planned_products" },
  { table: "regen_cases", column: "product_details" },
  { table: "regen_cases", column: "prior_treat_dates" },
  { table: "regen_cases", column: "co_meds" },
  { table: "regen_cases", column: "assoc_procedures" },
  { table: "whatsapp_outbox", column: "idempotency_key" },
  { table: "whatsapp_outbox", column: "next_attempt_at" },
  { table: "whatsapp_outbox", column: "last_error" },
  { table: "whatsapp_outbox", column: "intervention_required_at" },
  { table: "whatsapp_outbox", column: "alternate_escalated_at" },
  { table: "whatsapp_delivery_audit", column: "outcome" },
];

/**
 * Verifies (read-only) that all required schema objects exist. Throws with an
 * actionable message listing everything missing. Never issues DDL.
 */
export async function assertRequiredSchema(): Promise<void> {
  const { rows: tableRows } = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'`,
  );
  const existingTables = new Set(tableRows.map((r) => r.table_name));

  const missingTables = REQUIRED_TABLES.filter((t) => !existingTables.has(t));

  // Only probe columns for tables that actually exist to avoid noisy duplicate
  // errors (a missing table already implies its columns are missing).
  const columnsToCheck = REQUIRED_COLUMNS.filter((c) =>
    existingTables.has(c.table),
  );

  const missingColumns: RequiredColumn[] = [];
  if (columnsToCheck.length > 0) {
    const { rows: colRows } = await pool.query<{
      table_name: string;
      column_name: string;
    }>(
      `SELECT table_name, column_name FROM information_schema.columns
         WHERE table_schema = 'public'`,
    );
    const existingColumns = new Set(
      colRows.map((r) => `${r.table_name}.${r.column_name}`),
    );
    for (const c of columnsToCheck) {
      if (!existingColumns.has(`${c.table}.${c.column}`)) {
        missingColumns.push(c);
      }
    }
  }

  if (missingTables.length === 0 && missingColumns.length === 0) {
    logger.info("Schema assertion passed — all required objects present");
    return;
  }

  const parts: string[] = [];
  if (missingTables.length > 0) {
    parts.push(`missing tables: ${missingTables.join(", ")}`);
  }
  if (missingColumns.length > 0) {
    parts.push(
      `missing columns: ${missingColumns
        .map((c) => `${c.table}.${c.column}`)
        .join(", ")}`,
    );
  }

  throw new Error(
    `DocRegen database schema is out of date (${parts.join("; ")}). ` +
      `Apply the Drizzle schema to DOCREGEN_DATABASE_URL before starting: run ` +
      `pnpm --filter @workspace/docregen-db run push-force (development) or ` +
      `re-publish so the deploy schema diff runs (production). ` +
      `Startup DDL is disabled on managed PostgreSQL.`,
  );
}

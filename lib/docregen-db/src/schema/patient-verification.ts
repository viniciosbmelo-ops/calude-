import { pgTable, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * patient_verification_attempts — rate-limiting / lockout state for the
 * patient portal identity verification flow.
 *
 * Historically created ad-hoc via raw SQL at server startup; now modelled here
 * so Drizzle is the single source of truth. Column names, types, defaults, the
 * primary key and the partial index are reproduced EXACTLY as the raw DDL
 * created them.
 *
 * Accessed at runtime through raw `pool.query(...)` in
 * artifacts/api-server/src/lib/patient-session.ts.
 */
export const patientVerificationAttemptsTable = pgTable(
  "patient_verification_attempts",
  {
    keyHash: text("key_hash").primaryKey(),
    attempts: integer("attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Partial index: only rows with an active lockout are indexed.
    index("patient_verification_attempts_locked_until_idx")
      .on(t.lockedUntil)
      .where(sql`${t.lockedUntil} IS NOT NULL`),
  ],
);

export type PatientVerificationAttempt =
  typeof patientVerificationAttemptsTable.$inferSelect;

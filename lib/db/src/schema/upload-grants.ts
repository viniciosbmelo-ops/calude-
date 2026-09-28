import {
  check,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { doctorsTable } from "./doctors";
import { patientsTable } from "./patients";
import { surgeriesTable } from "./surgeries";

/**
 * upload_grants — pre-authorised upload slots, persisted in PostgreSQL.
 *
 * Flow:
 *  1. Authenticated endpoint creates a row with a random UUID token
 *     that is immediately hashed (SHA-256 hex) before storage.
 *  2. Frontend uploads the file directly to GCS using the signed PUT URL.
 *  3. Consuming endpoint atomically finds + marks used
 *     (UPDATE … WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
 *      RETURNING …) — exactly one row can win the race.
 *
 * Columns:
 *  - purpose: "surgery_media" | "patient_attachment" | "pre_consult_attachment" | "whatsapp_broadcast" | "xray"
 *  - doctor_id: always present; the doctor who initiated the grant.
 *  - surgery_id / patient_id: context-specific, nullable for WA broadcast.
 *  - object_path: the trusted GCS path from the server (never the client).
 *  - file_name / mime_type / media_type / expected_size: server-validated
 *    metadata stored at grant time; used at process time so client values
 *    are ignored.
 *  - token_hash: SHA-256(rawToken) hex; raw token never stored.
 *  - used_at: timestamp set atomically when the grant is consumed.
 *  - expires_at: 15-minute TTL enforced in the consuming UPDATE.
 */
export const uploadGrantsTable = pgTable(
  "upload_grants",
  {
    id: serial("id").primaryKey(),
    purpose: text("purpose").notNull(),
    doctorId: integer("doctor_id")
      .notNull()
      .references(() => doctorsTable.id, { onDelete: "cascade" }),
    surgeryId: integer("surgery_id").references(() => surgeriesTable.id, {
      onDelete: "cascade",
    }),
    patientId: integer("patient_id").references(() => patientsTable.id, {
      onDelete: "cascade",
    }),
    objectPath: text("object_path").notNull().unique(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    mediaType: text("media_type"),
    expectedSize: integer("expected_size"),
    /** GCS immutable version captured after the direct upload. */
    objectGeneration: text("object_generation"),
    tokenHash: text("token_hash").notNull().unique(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("upload_grants_expires_at_idx").on(t.expiresAt),
    check(
      "upload_grants_purpose_check",
      sql`${t.purpose} IN ('surgery_media', 'patient_attachment', 'pre_consult_attachment', 'whatsapp_broadcast', 'xray')`,
    ),
    check(
      "upload_grants_media_type_check",
      sql`${t.mediaType} IS NULL OR ${t.mediaType} IN ('photo', 'video')`,
    ),
  ],
);

export type UploadGrant = typeof uploadGrantsTable.$inferSelect;
export type InsertUploadGrant = typeof uploadGrantsTable.$inferInsert;

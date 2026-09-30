import {
  bigint,
  customType,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { doctorsTable } from "./doctors";

/**
 * Fixed-window rate-limit counters shared by every API instance (autoscale):
 * per-IP auth/registration/password-reset limiters, per-doctor AI summaries,
 * per-doctor WhatsApp sends. `key` is namespaced ("auth:<ip>", "ai:<doctorId>")
 * and never holds an e-mail, CPF or link token in clear.
 */
export const rateLimitBucketsTable = pgTable(
  "rate_limit_buckets",
  {
    key: text("key").primaryKey(),
    hits: integer("hits").notNull().default(0),
    resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("rate_limit_buckets_reset_at_idx").on(t.resetAt)],
);

/**
 * Per-account login lockout (doctor and secretary). `keyHash` is
 * SHA-256("<role>:<normalized e-mail or CPF>") — no identifier stored in clear.
 * N failures inside the window lock the account for a fixed period,
 * independently of the caller's IP.
 */
export const authLockoutsTable = pgTable(
  "auth_lockouts",
  {
    keyHash: text("key_hash").primaryKey(),
    failures: integer("failures").notNull().default(0),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull().defaultNow(),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("auth_lockouts_updated_at_idx").on(t.updatedAt)],
);

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

/**
 * Short-lived PDFs shared through an unguessable URL (iOS "open in Safari /
 * share" flow). Stored in the database instead of process memory so every
 * instance can serve them; expired rows are purged on write and periodically.
 */
export const tempPdfsTable = pgTable(
  "temp_pdfs",
  {
    id: text("id").primaryKey(),
    doctorId: integer("doctor_id")
      .notNull()
      .references(() => doctorsTable.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    content: bytea("content").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("temp_pdfs_expires_at_idx").on(t.expiresAt),
    index("temp_pdfs_doctor_idx").on(t.doctorId, t.expiresAt),
  ],
);

export type RateLimitBucket = typeof rateLimitBucketsTable.$inferSelect;
export type AuthLockout = typeof authLockoutsTable.$inferSelect;
export type TempPdf = typeof tempPdfsTable.$inferSelect;

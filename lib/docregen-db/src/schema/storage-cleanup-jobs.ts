import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Durable outbox for object-storage erasure.
 *
 * Rows are committed in the same transaction that removes the owning clinical
 * records, so a later storage outage cannot leave live database rows pointing
 * at files that were already erased. The API retries these jobs until deletion
 * succeeds (missing objects count as success).
 */
export const storageCleanupJobsTable = pgTable(
  "storage_cleanup_jobs",
  {
    id: serial("id").primaryKey(),
    objectPath: text("object_path").notNull().unique(),
    /** Version to erase; null is a legacy job and is handled conservatively. */
    objectGeneration: text("object_generation"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("storage_cleanup_jobs_next_attempt_idx").on(t.nextAttemptAt),
  ],
);

export type StorageCleanupJob = typeof storageCleanupJobsTable.$inferSelect;
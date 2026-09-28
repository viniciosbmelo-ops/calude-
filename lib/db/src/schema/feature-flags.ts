/**
 * Feature flags with versioning and audit trail.
 * Public read endpoints reveal only: key, enabled, and variant (no admin metadata).
 */
import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

export const featureFlagsTable = pgTable(
  "feature_flags",
  {
    id: serial("id").primaryKey(),
    /** Unique machine-readable key, e.g. "new_dashboard_beta". */
    key: text("key").notNull().unique(),
    /** Human-readable description for admins. */
    description: text("description"),
    /** Whether the flag is currently enabled globally. */
    enabled: boolean("enabled").notNull().default(false),
    /**
     * Optional variant string for A/B scenarios (e.g. "v2", "control").
     * Safe to expose publicly — no PII.
     */
    variant: text("variant"),
    /**
     * Monotonic version counter. Incremented on every update.
     * Useful for cache-busting on the client.
     */
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
    /** Doctor ID who last modified this flag. */
    updatedBy: integer("updated_by"),
  },
  (t) => [
    index("feature_flags_key_idx").on(t.key),
  ],
);

export type FeatureFlag = typeof featureFlagsTable.$inferSelect;

// ─── Feature flag audit log ───────────────────────────────────────────────────

export const featureFlagAuditTable = pgTable(
  "feature_flag_audit",
  {
    id: serial("id").primaryKey(),
    flagId: integer("flag_id").notNull(),
    flagKey: text("flag_key").notNull(),
    action: text("action").notNull(), // 'created' | 'updated' | 'deleted'
    changedBy: integer("changed_by").notNull(),
    previousValue: text("previous_value"), // JSON snapshot of previous state
    newValue: text("new_value"),           // JSON snapshot of new state
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("feature_flag_audit_flag_id_idx").on(t.flagId),
    index("feature_flag_audit_created_at_idx").on(t.createdAt),
  ],
);

export type FeatureFlagAudit = typeof featureFlagAuditTable.$inferSelect;

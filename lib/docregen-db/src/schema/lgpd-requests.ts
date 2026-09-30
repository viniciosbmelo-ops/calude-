import { index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { doctorsTable } from "./doctors";

/**
 * Data-subject requests made by a doctor (LGPD Art. 18) — today only account
 * deletion. The operator is notified by e-mail (DOCREGEN_CONTACT_EMAIL) and
 * handles the request manually (see replit.md, "LGPD"); `status` is what the
 * doctor sees: pending → notified | notification_failed → completed | rejected.
 */
export const lgpdRequestsTable = pgTable(
  "lgpd_requests",
  {
    id: serial("id").primaryKey(),
    doctorId: integer("doctor_id")
      .notNull()
      .references(() => doctorsTable.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("account_deletion"),
    status: text("status").notNull().default("pending"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    notificationError: text("notification_error"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolutionNote: text("resolution_note"),
  },
  (t) => [index("lgpd_requests_doctor_idx").on(t.doctorId, t.requestedAt)],
);

export type LgpdRequest = typeof lgpdRequestsTable.$inferSelect;

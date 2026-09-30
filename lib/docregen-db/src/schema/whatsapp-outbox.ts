import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { doctorsTable } from "./doctors";

export const whatsappOutboxTable = pgTable("whatsapp_outbox", {
  id: serial("id").primaryKey(),
  eventType: text("event_type").notNull(),
  /** Doctor who queued the message (per-doctor rate limit, anonymization). */
  doctorId: integer("doctor_id").references(() => doctorsTable.id, { onDelete: "cascade" }),
  idempotencyKey: text("idempotency_key").notNull(),
  recipient: text("recipient").notNull(),
  message: text("message").notNull(),
  status: text("status").notNull().default("pending"), // pending | processing | sent | failed | uncertain
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(5),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  provider: text("provider"),
  providerMessageId: text("provider_message_id"),
  lastError: text("last_error"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  failedAt: timestamp("failed_at", { withTimezone: true }),
  interventionRequiredAt: timestamp("intervention_required_at", { withTimezone: true }),
  alternateEscalatedAt: timestamp("alternate_escalated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("whatsapp_outbox_idempotency_key_unique").on(t.idempotencyKey),
  index("whatsapp_outbox_dispatch_idx").on(t.status, t.nextAttemptAt),
  index("whatsapp_outbox_doctor_idx").on(t.doctorId, t.createdAt),
]);

export const whatsappDeliveryAuditTable = pgTable("whatsapp_delivery_audit", {
  id: serial("id").primaryKey(),
  outboxId: integer("outbox_id").notNull().references(() => whatsappOutboxTable.id, { onDelete: "cascade" }),
  attempt: integer("attempt").notNull(),
  outcome: text("outcome").notNull(), // delivered | retry_scheduled | failed_final | delivery_uncertain
  provider: text("provider"),
  providerMessageId: text("provider_message_id"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("whatsapp_delivery_audit_attempt_unique").on(t.outboxId, t.attempt),
  index("whatsapp_delivery_audit_outbox_idx").on(t.outboxId, t.createdAt),
]);

export type WhatsAppOutbox = typeof whatsappOutboxTable.$inferSelect;
export type WhatsAppDeliveryAudit = typeof whatsappDeliveryAuditTable.$inferSelect;
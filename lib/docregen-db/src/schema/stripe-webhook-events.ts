import { pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";

/**
 * Persists Stripe webhook event IDs for idempotent deduplication.
 * A unique constraint on stripe_event_id prevents double-processing.
 */
export const stripeWebhookEventsTable = pgTable("stripe_webhook_events", {
  id: serial("id").primaryKey(),
  stripeEventId: text("stripe_event_id").notNull(),
  eventType: text("event_type").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("stripe_webhook_events_event_id_unique").on(t.stripeEventId),
]);

export type StripeWebhookEvent = typeof stripeWebhookEventsTable.$inferSelect;

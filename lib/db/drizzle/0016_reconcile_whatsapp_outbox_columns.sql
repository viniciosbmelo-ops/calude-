-- Reconcile deployments that applied the first outbox migration before the
-- delivery-intervention columns were added to its fresh-install definition.
-- IF NOT EXISTS keeps this safe for databases created from the current 0014.
ALTER TABLE "whatsapp_outbox"
  ADD COLUMN IF NOT EXISTS "scheduled_notification_id" integer;
--> statement-breakpoint
ALTER TABLE "whatsapp_outbox"
  ADD COLUMN IF NOT EXISTS "intervention_required_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "whatsapp_outbox"
  ADD COLUMN IF NOT EXISTS "alternate_escalated_at" timestamp with time zone;
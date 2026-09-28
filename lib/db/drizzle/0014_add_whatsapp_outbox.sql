CREATE TABLE "whatsapp_delivery_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"outbox_id" integer NOT NULL,
	"attempt" integer NOT NULL,
	"outcome" text NOT NULL,
	"provider" text,
	"provider_message_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_outbox" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"assessment_id" integer,
	"scheduled_notification_id" integer,
	"idempotency_key" text NOT NULL,
	"recipient" text NOT NULL,
	"message" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"provider" text,
	"provider_message_id" text,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"intervention_required_at" timestamp with time zone,
	"alternate_escalated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "whatsapp_delivery_audit" ADD CONSTRAINT "whatsapp_delivery_audit_outbox_id_whatsapp_outbox_id_fk" FOREIGN KEY ("outbox_id") REFERENCES "public"."whatsapp_outbox"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_delivery_audit_attempt_unique" ON "whatsapp_delivery_audit" USING btree ("outbox_id","attempt");--> statement-breakpoint
CREATE INDEX "whatsapp_delivery_audit_outbox_idx" ON "whatsapp_delivery_audit" USING btree ("outbox_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_outbox_idempotency_key_unique" ON "whatsapp_outbox" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_outbox_assessment_event_unique" ON "whatsapp_outbox" USING btree ("assessment_id","event_type");--> statement-breakpoint
CREATE INDEX "whatsapp_outbox_dispatch_idx" ON "whatsapp_outbox" USING btree ("status","next_attempt_at");
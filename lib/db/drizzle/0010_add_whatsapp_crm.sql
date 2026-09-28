CREATE TABLE "whatsapp_contacts" (
"id" serial PRIMARY KEY NOT NULL,
"phone_e164" text NOT NULL,
"display_name" text,
"profile_name" text,
"patient_id" integer,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_conversations" (
"id" serial PRIMARY KEY NOT NULL,
"contact_id" integer NOT NULL,
"provider" text DEFAULT 'evolution' NOT NULL,
"provider_conversation_id" text,
"patient_id" integer,
"patient_link_source" text,
"status" text DEFAULT 'new' NOT NULL,
"unread_count" integer DEFAULT 0 NOT NULL,
"last_message_preview" text,
"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
"tags" text[] DEFAULT '{}' NOT NULL,
"assigned_to" integer,
"created_at" timestamp with time zone DEFAULT now() NOT NULL,
"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_messages" (
"id" serial PRIMARY KEY NOT NULL,
"conversation_id" integer NOT NULL,
"provider_message_id" text,
"client_request_id" text,
"direction" text NOT NULL,
"status" text DEFAULT 'received' NOT NULL,
"message_type" text DEFAULT 'text' NOT NULL,
"content" text NOT NULL,
"sent_by" integer,
"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_webhook_events" (
"id" serial PRIMARY KEY NOT NULL,
"provider_event_id" text NOT NULL,
"event_name" text NOT NULL,
"processed_at" timestamp with time zone,
"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "whatsapp_contacts" ADD CONSTRAINT "whatsapp_contacts_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_contact_id_whatsapp_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."whatsapp_contacts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_assigned_to_doctors_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."doctors"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_conversation_id_whatsapp_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."whatsapp_conversations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_sent_by_doctors_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."doctors"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_contacts_phone_e164_unique" ON "whatsapp_contacts" USING btree ("phone_e164");
--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_conversations_provider_contact_unique" ON "whatsapp_conversations" USING btree ("provider","contact_id");
--> statement-breakpoint
CREATE INDEX "whatsapp_conversations_last_message_idx" ON "whatsapp_conversations" USING btree ("last_message_at");
--> statement-breakpoint
CREATE INDEX "whatsapp_conversations_status_idx" ON "whatsapp_conversations" USING btree ("status");
--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_messages_provider_message_unique" ON "whatsapp_messages" USING btree ("provider_message_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_messages_client_request_unique" ON "whatsapp_messages" USING btree ("client_request_id");
--> statement-breakpoint
CREATE INDEX "whatsapp_messages_conversation_created_idx" ON "whatsapp_messages" USING btree ("conversation_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_webhook_events_provider_id_unique" ON "whatsapp_webhook_events" USING btree ("provider_event_id");
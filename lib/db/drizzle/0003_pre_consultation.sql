CREATE TABLE "pre_consult_questionnaires" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"doctor_id" integer NOT NULL,
	"questionnaire_version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"draft_answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"patient_answers" jsonb,
	"current_answers" jsonb,
	"last_patient_saved_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"doctor_edited_at" timestamp with time zone,
	"doctor_edited_by_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pre_consult_questionnaires_status_check" CHECK ("pre_consult_questionnaires"."status" IN ('draft', 'submitted'))
);
--> statement-breakpoint
CREATE TABLE "pre_consult_invites" (
	"id" serial PRIMARY KEY NOT NULL,
	"questionnaire_id" integer NOT NULL,
	"patient_id" integer NOT NULL,
	"doctor_id" integer NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_accessed_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pre_consult_invites_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "pre_consult_invites_status_check" CHECK ("pre_consult_invites"."status" IN ('active', 'revoked', 'submitted'))
);
--> statement-breakpoint
ALTER TABLE "pre_consult_questionnaires" ADD CONSTRAINT "pre_consult_questionnaires_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pre_consult_questionnaires" ADD CONSTRAINT "pre_consult_questionnaires_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pre_consult_questionnaires" ADD CONSTRAINT "pre_consult_questionnaires_doctor_edited_by_id_doctors_id_fk" FOREIGN KEY ("doctor_edited_by_id") REFERENCES "public"."doctors"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pre_consult_invites" ADD CONSTRAINT "pre_consult_invites_questionnaire_id_pre_consult_questionnaires_id_fk" FOREIGN KEY ("questionnaire_id") REFERENCES "public"."pre_consult_questionnaires"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pre_consult_invites" ADD CONSTRAINT "pre_consult_invites_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pre_consult_invites" ADD CONSTRAINT "pre_consult_invites_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "patient_attachments" ADD COLUMN "pre_consult_questionnaire_id" integer;
--> statement-breakpoint
ALTER TABLE "patient_attachments" ADD CONSTRAINT "patient_attachments_pre_consult_questionnaire_id_pre_consult_questionnaires_id_fk" FOREIGN KEY ("pre_consult_questionnaire_id") REFERENCES "public"."pre_consult_questionnaires"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "pre_consult_questionnaires_patient_unique" ON "pre_consult_questionnaires" USING btree ("patient_id");
--> statement-breakpoint
CREATE INDEX "pre_consult_questionnaires_doctor_idx" ON "pre_consult_questionnaires" USING btree ("doctor_id");
--> statement-breakpoint
CREATE INDEX "pre_consult_invites_patient_idx" ON "pre_consult_invites" USING btree ("patient_id");
--> statement-breakpoint
CREATE INDEX "pre_consult_invites_questionnaire_idx" ON "pre_consult_invites" USING btree ("questionnaire_id");
--> statement-breakpoint
CREATE INDEX "pre_consult_invites_expires_at_idx" ON "pre_consult_invites" USING btree ("expires_at");
--> statement-breakpoint
ALTER TABLE "upload_grants" DROP CONSTRAINT IF EXISTS "upload_grants_purpose_check";
--> statement-breakpoint
ALTER TABLE "upload_grants" ADD CONSTRAINT "upload_grants_purpose_check" CHECK ("upload_grants"."purpose" IN ('surgery_media', 'patient_attachment', 'pre_consult_attachment', 'whatsapp_broadcast', 'xray'));
--> statement-breakpoint
CREATE TABLE "storage_cleanup_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"object_path" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storage_cleanup_jobs_object_path_unique" UNIQUE("object_path")
);
--> statement-breakpoint
CREATE INDEX "storage_cleanup_jobs_next_attempt_idx" ON "storage_cleanup_jobs" USING btree ("next_attempt_at");
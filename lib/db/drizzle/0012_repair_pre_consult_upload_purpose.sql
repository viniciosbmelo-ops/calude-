-- Repair environments where the pre-consult schema exists but the historical
-- upload_grants purpose constraint was left at its older value set.
ALTER TABLE "upload_grants"
  DROP CONSTRAINT IF EXISTS "upload_grants_purpose_check";
--> statement-breakpoint
ALTER TABLE "upload_grants"
  ADD CONSTRAINT "upload_grants_purpose_check"
  CHECK ("purpose" IN (
    'surgery_media',
    'patient_attachment',
    'pre_consult_attachment',
    'whatsapp_broadcast',
    'xray'
  ));
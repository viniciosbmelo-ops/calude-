-- Pre-push data fix: remove 'xray' from upload_grants.purpose.
--
-- drizzle-kit push applies a changed CHECK constraint as a separate DROP and
-- ADD with no surrounding transaction and without surfacing the ADD failure.
-- If any row still had purpose = 'xray', the ADD would fail and leave the
-- table with NO purpose constraint while the push still reported success.
--
-- This script runs BEFORE drizzle-kit push (see scripts/post-merge.sh). It
-- deletes stale X-ray grants and swaps the constraint atomically, so push then
-- finds the table already matching lib/db/src/schema/upload-grants.ts.
-- Idempotent, and a no-op on a fresh database where the table does not exist.
BEGIN;
DO $$
BEGIN
  IF to_regclass('public.upload_grants') IS NOT NULL THEN
    DELETE FROM upload_grants WHERE purpose = 'xray';
    ALTER TABLE upload_grants DROP CONSTRAINT IF EXISTS upload_grants_purpose_check;
    ALTER TABLE upload_grants ADD CONSTRAINT upload_grants_purpose_check
      CHECK (purpose IN ('surgery_media', 'patient_attachment', 'pre_consult_attachment', 'whatsapp_broadcast'));
  END IF;
END
$$;
COMMIT;

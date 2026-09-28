-- Metadata-only checkpoint.
--
-- Migration 0003 is custom SQL because earlier hand-authored migrations did
-- not have complete snapshots. This no-op migration was generated from the
-- current Drizzle schema to register the complete post-pre-consult snapshot
-- without replaying changes already applied by 0002 and 0003.
SELECT 1;
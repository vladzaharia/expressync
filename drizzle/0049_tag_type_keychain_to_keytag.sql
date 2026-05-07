-- Migration 0049 — rename `keychain` → `keytag`.
--
-- 0048 collapsed the taxonomy and renamed `keytag` → `keychain` for
-- friendlier copy. We're walking that back: the canonical name is
-- `keytag` (the original short-UID 4-byte RFID identifier), and the
-- UI label becomes "Keytag". Pure rename — no data is lost.

ALTER TABLE "user_mappings"
  DROP CONSTRAINT IF EXISTS "user_mappings_tag_type_check";
--> statement-breakpoint

UPDATE "user_mappings" SET "tag_type" = 'keytag' WHERE "tag_type" = 'keychain';
--> statement-breakpoint

ALTER TABLE "user_mappings"
  ADD CONSTRAINT "user_mappings_tag_type_check"
  CHECK ("tag_type" IN ('ev_card', 'keytag', 'app', 'meta'));

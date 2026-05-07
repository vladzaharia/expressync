-- Migration 0048 — simplify user_mappings.tag_type taxonomy.
--
-- 2026-05-07 cleanup: the original taxonomy had 7 values (ev_card,
-- keytag, sticker, phone_nfc, guest_qr, app, other) which over time
-- collapsed to four meaningful categories. Reducing to:
--
--   ev_card  — physical RFID card (the chargeable customer-facing
--              identity).
--   keychain — short-form keychain fob (renamed from keytag for the
--              friendlier label).
--   app      — app-issued or in-app identity (customer iOS device
--              tags + guest QR codes both fall here).
--   meta     — system-managed parent / aggregate tag. NOT user-
--              selectable; carried by `META-<publicId>` and (legacy)
--              `OCPP-<...>` parent meta-tags.
--
-- Data remap (lossy but reasonable):
--   phone_nfc → app       (customer device registration tags ARE app-
--                          mediated identities).
--   guest_qr  → app
--   sticker   → ev_card   (most similar physical form-factor; admin
--                          can downgrade to keychain via the picker).
--   keytag    → keychain  (rename only).
--   other     → ev_card   (safest default; admin can re-classify).
--
-- Plus an inference pass that overrides anything matching a known
-- prefix to its correct type:
--   META-*           → meta
--   OCPP-* (not OCPP-D-*) → meta (legacy parent tags, awaiting cleanup)
--   OCPP-D-*         → app

-- Step 1: drop the old CHECK constraint so the data remap can run.
ALTER TABLE "user_mappings"
  DROP CONSTRAINT IF EXISTS "user_mappings_tag_type_check";
--> statement-breakpoint

-- Step 2: data remap based on the lossy mapping above.
UPDATE "user_mappings" SET "tag_type" = 'app'      WHERE "tag_type" = 'phone_nfc';
--> statement-breakpoint
UPDATE "user_mappings" SET "tag_type" = 'app'      WHERE "tag_type" = 'guest_qr';
--> statement-breakpoint
UPDATE "user_mappings" SET "tag_type" = 'ev_card'  WHERE "tag_type" = 'sticker';
--> statement-breakpoint
UPDATE "user_mappings" SET "tag_type" = 'keychain' WHERE "tag_type" = 'keytag';
--> statement-breakpoint
UPDATE "user_mappings" SET "tag_type" = 'ev_card'  WHERE "tag_type" = 'other';
--> statement-breakpoint

-- Step 3: prefix-based override. The previous step put everything in
-- one of the four new buckets; this step corrects rows whose idTag
-- structure tells us better.
UPDATE "user_mappings" SET "tag_type" = 'meta'
  WHERE "steve_ocpp_id_tag" LIKE 'META-%';
--> statement-breakpoint
UPDATE "user_mappings" SET "tag_type" = 'meta'
  WHERE "steve_ocpp_id_tag" LIKE 'OCPP-%'
    AND "steve_ocpp_id_tag" NOT LIKE 'OCPP-D-%';
--> statement-breakpoint
UPDATE "user_mappings" SET "tag_type" = 'app'
  WHERE "steve_ocpp_id_tag" LIKE 'OCPP-D-%';
--> statement-breakpoint

-- Step 4: also set tag_type = 'meta' on any row whose idTag matches
-- the parent-meta convention but somehow escaped the LIKE patterns
-- above (defensive — should be a no-op on a clean DB).

-- Step 5: re-add CHECK constraint with the new four-value enum.
ALTER TABLE "user_mappings"
  ADD CONSTRAINT "user_mappings_tag_type_check"
  CHECK ("tag_type" IN ('ev_card', 'keychain', 'app', 'meta'));
--> statement-breakpoint

-- Step 6: change the column default from 'other' (now invalid) to
-- 'ev_card' (the dominant physical category).
ALTER TABLE "user_mappings"
  ALTER COLUMN "tag_type" SET DEFAULT 'ev_card';

-- ExpresScan v2 — capability vocabulary rename (Wave 6 Slice A).
--
-- Renames the legacy `tap` capability to `scanner` and `ev` to `charger`,
-- in preparation for the expanded set `{scanner, charger, user, kiosk}`.
--
-- Why both renames:
--   - `tap` was a verb describing the action; `scanner` is a noun matching
--     the device's role. Symmetric with `charger`.
--   - `ev` is ambiguous (could mean the vehicle, the standard, or the
--     station). `charger` is unambiguous: the device IS a charging station.
--
-- Scope:
--   - `devices.capabilities` (text[]) gets array-replaces.
--     In practice no production rows carry `'ev'` today (chargers live in
--     `chargers_cache`, not `devices`), but the array_replace is defensive.
--   - The `tappable_devices` view hard-codes `ARRAY['ev','tap']` for the
--     charger half of the union; we drop and recreate it with the new
--     vocabulary.
--   - The `devices.capabilities` DEFAULT is updated.
--   - A new CHECK constraint forbids the legacy strings on future writes,
--     so a forgotten call site fails loudly rather than silently mixing
--     vocabularies.
--
-- The future capabilities `{user, kiosk}` are added to the type system
-- in subsequent slices (B5); this migration only renames existing rows.

-- Step 1: rename existing capability values in `devices.capabilities`.
UPDATE "devices"
SET "capabilities" = array_replace(
  array_replace("capabilities", 'tap', 'scanner'),
  'ev', 'charger'
)
WHERE 'tap' = ANY("capabilities") OR 'ev' = ANY("capabilities");
--> statement-breakpoint

-- Step 2: update the column default so newly-inserted rows get `'scanner'`.
ALTER TABLE "devices"
  ALTER COLUMN "capabilities" SET DEFAULT ARRAY['scanner']::text[];
--> statement-breakpoint

-- Step 3: drop the old `tappable_devices` view (it embeds the legacy
-- `ARRAY['ev','tap']` literal for the charger half). Replace with a
-- version emitting the new vocabulary.
DROP VIEW IF EXISTS "tappable_devices";
--> statement-breakpoint

CREATE VIEW "tappable_devices" AS
  SELECT
    "charge_box_id"                              AS "id",
    'charger'::text                              AS "kind",
    COALESCE("friendly_name", "charge_box_id")   AS "label",
    ARRAY['charger','scanner']::text[]           AS "capabilities",
    NULL::text                                   AS "owner_user_id",
    "first_seen_at"                              AS "registered_at",
    "last_seen_at",
    NULL::timestamptz                            AS "deleted_at",
    NULL::timestamptz                            AS "revoked_at"
  FROM "chargers_cache"
UNION ALL
  SELECT
    "id"::text,
    "kind",
    "label",
    "capabilities",
    "owner_user_id",
    "registered_at",
    "last_seen_at",
    "deleted_at",
    "revoked_at"
  FROM "devices"
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

-- Step 4: add a CHECK constraint enforcing the capability invariants on
-- `devices.capabilities`:
--   - the legacy `'tap'` and `'ev'` strings are never present on writes
--     (a forgotten call site fails loudly rather than silently mixing
--     vocabularies);
--   - `'charger'` is never present (apps can never be chargers — chargers
--     live in `chargers_cache` and are surfaced through the
--     `tappable_devices` view, never as `devices` rows).
-- The positive vocabulary `{scanner, user, kiosk}` is enforced more
-- permissively at the application layer (Zod / TS enum) so that forward
-- capability additions land without a migration.
ALTER TABLE "devices"
  ADD CONSTRAINT "devices_capabilities_invariants_check"
  CHECK (
    NOT ('tap'     = ANY("capabilities"))
    AND NOT ('ev'      = ANY("capabilities"))
    AND NOT ('charger' = ANY("capabilities"))
  );

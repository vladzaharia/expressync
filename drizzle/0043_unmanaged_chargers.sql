-- Unmanaged chargers — non-OCPP units (e.g. Tesla Wall Connectors) that
-- live entirely in our DB and never talk to StEvE.
--
-- Why:
--   Until now, every row in `chargers_cache` originated from a StEvE
--   transaction or operation log entry — chargers self-registered via OCPP
--   and the sync worker upserted them. That excluded a whole class of
--   chargers (Tesla Wall Connectors and other "dumb" units) that don't
--   speak OCPP and never will. We want to track them as first-class
--   chargers in the admin UI and the customer mobile app, but with no
--   sessions, no operations, and no billing — they're flat-out free.
--
-- Changes:
--   1. Add `chargers_cache.management_mode text NOT NULL DEFAULT 'ocpp'`
--      with a CHECK pinning the values to {'ocpp','unmanaged'}. Existing
--      rows pick up `'ocpp'` via the column default; no backfill needed.
--   2. Add `chargers_cache.location_description text` (nullable). For
--      OCPP chargers this stays null; for unmanaged chargers the admin
--      enters free-text location info ("North lot, level 2") that the
--      web fallback page and admin detail surface to humans.
--   3. Drop and recreate `tappable_devices` so the charger half of the
--      union exposes `management_mode` to consumers (the iOS /api/devices
--      endpoint left-joins back to `chargers_cache` so this is mostly
--      defensive — but downstream queries that read the view directly
--      need the column).
--
-- The sync worker (`src/services/charger-cache.service.ts`) already
-- omits `management_mode` from its `onConflictDoUpdate` set (it isn't in
-- the values payload, so Drizzle doesn't touch it). Unmanaged rows
-- created by the admin form survive every sync run untouched.

-- Step 1: management_mode column with safe default for existing rows.
ALTER TABLE "chargers_cache"
  ADD COLUMN "management_mode" text NOT NULL DEFAULT 'ocpp';
--> statement-breakpoint

-- Step 2: pin management_mode to the two known values.
ALTER TABLE "chargers_cache"
  ADD CONSTRAINT "chargers_cache_management_mode_check"
  CHECK ("management_mode" IN ('ocpp', 'unmanaged'));
--> statement-breakpoint

-- Step 3: nullable free-text location for unmanaged chargers.
ALTER TABLE "chargers_cache"
  ADD COLUMN "location_description" text;
--> statement-breakpoint

-- Step 4: recreate `tappable_devices` to expose `management_mode` on the
-- charger half. The devices half emits NULL — apps don't have a
-- management mode in the OCPP sense.
DROP VIEW IF EXISTS "tappable_devices";
--> statement-breakpoint

CREATE VIEW "tappable_devices" AS
  SELECT
    "charge_box_id"                              AS "id",
    'charger'::text                              AS "kind",
    COALESCE("friendly_name", "charge_box_id")   AS "label",
    "capabilities"                               AS "capabilities",
    "management_mode"                            AS "management_mode",
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
    NULL::text                                   AS "management_mode",
    "owner_user_id",
    "registered_at",
    "last_seen_at",
    "deleted_at",
    "revoked_at"
  FROM "devices"
  WHERE "deleted_at" IS NULL;

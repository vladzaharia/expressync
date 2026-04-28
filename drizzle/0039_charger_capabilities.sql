-- ExpresScan v2 / Wave 6 Slice O —
-- chargers carry their own capabilities (mirrors the `devices.capabilities`
-- column added in slice A).
--
-- Why:
--   The Wave 6 slices A/B/C/D introduced first-class capability management
--   for *app* devices (`devices.capabilities`). Charger rows were left out
--   because the `tappable_devices` view hard-coded `ARRAY['charger','scanner']`
--   for the charger half of the union. That meant an admin couldn't disable
--   the `scanner` capability on a charger (e.g. when the EV-side hardware
--   doesn't accept tap-to-pair), and the per-row capability set wasn't
--   queryable.
--
-- Changes:
--   1. Add `chargers_cache.capabilities text[] NOT NULL DEFAULT ['charger']`.
--   2. Backfill every existing row with `ARRAY['charger']`. Apps cannot
--      escalate a charger to `scanner` retroactively — that's an
--      admin-driven decision per row from now on.
--   3. CHECK constraint pinning `'charger'` ON and forbidding the app-side
--      capabilities `{user, kiosk}` plus the legacy `{tap, ev}` strings.
--      The only admin-editable capability on a charger is `'scanner'`.
--      `'management'` is also forbidden — it's a legacy app-only token
--      that never made sense on a charger.
--   4. Drop and recreate `tappable_devices` so the charger half pulls from
--      `cc.capabilities` directly instead of the hard-coded array literal.

-- Step 1: add the column with a safe default.
ALTER TABLE "chargers_cache"
  ADD COLUMN "capabilities" text[] NOT NULL DEFAULT ARRAY['charger']::text[];
--> statement-breakpoint

-- Step 2: backfill (defensive — DEFAULT already covers existing rows on
-- Postgres ≥ 11, but a re-run on a partial environment shouldn't shift
-- rows away from the canonical baseline).
UPDATE "chargers_cache"
  SET "capabilities" = ARRAY['charger']::text[]
  WHERE NOT ('charger' = ANY("capabilities"));
--> statement-breakpoint

-- Step 3: CHECK invariants. `'charger'` is always present; the app-side
-- capability tokens (`user`, `kiosk`, legacy `management`) and the
-- pre-Slice-A legacy strings (`tap`, `ev`) are forbidden. The only
-- editable token is `'scanner'`.
ALTER TABLE "chargers_cache"
  ADD CONSTRAINT "chargers_cache_capabilities_invariants_check"
  CHECK (
    ('charger' = ANY("capabilities"))
    AND NOT ('user'       = ANY("capabilities"))
    AND NOT ('kiosk'      = ANY("capabilities"))
    AND NOT ('management' = ANY("capabilities"))
    AND NOT ('tap'        = ANY("capabilities"))
    AND NOT ('ev'         = ANY("capabilities"))
  );
--> statement-breakpoint

-- Step 4: drop and recreate `tappable_devices` so the charger half reads
-- the per-row capability set from `chargers_cache.capabilities` directly.
DROP VIEW IF EXISTS "tappable_devices";
--> statement-breakpoint

CREATE VIEW "tappable_devices" AS
  SELECT
    "charge_box_id"                              AS "id",
    'charger'::text                              AS "kind",
    COALESCE("friendly_name", "charge_box_id")   AS "label",
    "capabilities"                               AS "capabilities",
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

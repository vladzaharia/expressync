-- Migration 0050 — three intertwined changes against the charger model:
--
--   1. Rename `chargers_cache` → `chargers`. The `_cache` suffix was a
--      historical artefact: the table started as a sticky local mirror of
--      StEvE rows but has long since become the source of truth for
--      unmanaged chargers and the canonical join target for sessions /
--      reservations / devices.
--
--   2. Promote per-connector spec (connector type + max kW) to a real
--      `charger_connectors` table keyed by `(charge_box_id,
--      connector_id)`. Every existing row in `chargers` gets a
--      connector-1 row carrying its old override values; the two old
--      columns are dropped after the backfill.
--
--   3. Add three identity-override columns on `chargers`
--      (`vendor_override`, `model_override`, `firmware_version_override`)
--      so admins can override what StEvE reports — useful when StEvE
--      surfaces wrong/missing values on long-tail charger firmwares.
--
-- Constraints, indexes, and the `tappable_devices` view all get renamed
-- alongside the table so the schema stays internally consistent.

-- =========================================================================
-- Step 1: rename the table.
-- =========================================================================
ALTER TABLE "chargers_cache" RENAME TO "chargers";
--> statement-breakpoint

-- Rename the unique index on public_id (PostgreSQL doesn't auto-rename
-- supporting indexes when you rename a table).
ALTER INDEX "chargers_cache_public_id_key" RENAME TO "chargers_public_id_key";
--> statement-breakpoint

-- Rename the regular index on last_seen_at.
ALTER INDEX "idx_chargers_cache_last_seen" RENAME TO "idx_chargers_last_seen";
--> statement-breakpoint

-- Rename every named CHECK constraint so the table's constraints share
-- its new name. Constraint names are visible in error messages and
-- pg_dump output — keeping them in sync prevents future "why is this
-- constraint named after a table that no longer exists?" confusion.
ALTER TABLE "chargers" RENAME CONSTRAINT "chargers_cache_form_factor_check"
  TO "chargers_form_factor_check";
--> statement-breakpoint
ALTER TABLE "chargers" RENAME CONSTRAINT "chargers_cache_public_id_format_check"
  TO "chargers_public_id_format_check";
--> statement-breakpoint
ALTER TABLE "chargers" RENAME CONSTRAINT "chargers_cache_latitude_range_check"
  TO "chargers_latitude_range_check";
--> statement-breakpoint
ALTER TABLE "chargers" RENAME CONSTRAINT "chargers_cache_longitude_range_check"
  TO "chargers_longitude_range_check";
--> statement-breakpoint
ALTER TABLE "chargers" RENAME CONSTRAINT "chargers_cache_address_country_format_check"
  TO "chargers_address_country_format_check";
--> statement-breakpoint
ALTER TABLE "chargers" RENAME CONSTRAINT "chargers_cache_management_mode_check"
  TO "chargers_management_mode_check";
--> statement-breakpoint
ALTER TABLE "chargers" RENAME CONSTRAINT "chargers_cache_capabilities_invariants_check"
  TO "chargers_capabilities_invariants_check";
--> statement-breakpoint

-- =========================================================================
-- Step 2: per-connector spec table + backfill.
-- =========================================================================
CREATE TABLE "charger_connectors" (
  "charge_box_id" text NOT NULL
    REFERENCES "chargers"("charge_box_id") ON DELETE CASCADE,
  "connector_id" integer NOT NULL,
  "connector_type" text,
  "max_kw" numeric(6, 2),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("charge_box_id", "connector_id"),
  CONSTRAINT "charger_connectors_connector_id_check"
    CHECK ("connector_id" >= 0),
  CONSTRAINT "charger_connectors_connector_type_check"
    CHECK (
      "connector_type" IS NULL
      OR "connector_type" IN ('ccs', 'j1772', 'nacs', 'chademo', 'type2')
    ),
  CONSTRAINT "charger_connectors_max_kw_check"
    CHECK ("max_kw" IS NULL OR ("max_kw" > 0 AND "max_kw" <= 1000))
);
--> statement-breakpoint

-- Backfill: every existing charger gets a connector-1 row carrying its
-- old per-charger override values. NULLs flow through cleanly — chargers
-- that never had an override produce a `(charge_box_id, 1, NULL, NULL)`
-- placeholder, which renders identically to today's "—" fallback.
INSERT INTO "charger_connectors"
  ("charge_box_id", "connector_id", "connector_type", "max_kw")
SELECT
  "charge_box_id",
  1,
  "connector_type_override",
  "max_kw_override"
FROM "chargers";
--> statement-breakpoint

-- Drop the old per-charger override columns + their CHECKs now that the
-- data has been migrated to `charger_connectors`.
ALTER TABLE "chargers"
  DROP CONSTRAINT IF EXISTS "chargers_cache_connector_type_override_check";
--> statement-breakpoint
ALTER TABLE "chargers"
  DROP CONSTRAINT IF EXISTS "chargers_cache_max_kw_override_check";
--> statement-breakpoint
ALTER TABLE "chargers"
  DROP COLUMN "connector_type_override",
  DROP COLUMN "max_kw_override";
--> statement-breakpoint

-- =========================================================================
-- Step 3: identity-override columns. Free-text — no CHECKs needed (the
-- API endpoint length-caps these at 200).
-- =========================================================================
ALTER TABLE "chargers"
  ADD COLUMN "vendor_override" text,
  ADD COLUMN "model_override" text,
  ADD COLUMN "firmware_version_override" text;
--> statement-breakpoint

-- =========================================================================
-- Step 4: recreate `tappable_devices`. The view's charger half SELECTs
-- from `chargers_cache`, which no longer exists — so the view has to be
-- dropped and re-issued against the renamed table. Same column shape as
-- before, only the FROM changes.
-- =========================================================================
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
  FROM "chargers"
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

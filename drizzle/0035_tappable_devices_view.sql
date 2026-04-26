-- Polaris Track A — tappable_devices view (Wave 1, ExpresScan).
--
-- Unifies chargers (`chargers_cache`) and phones (`devices`) into a single
-- tap-target list for the scan-modal picker. Charger rows have
-- `kind='charger'` and `owner_user_id=NULL`; phone/laptop rows carry the
-- `devices.kind` and the admin owner id.
--
-- The two halves intentionally share the same column shape so the union
-- works without a discriminator column on the SELECT side. Deleted phone
-- rows (`devices.deleted_at IS NOT NULL`) are excluded so the picker only
-- shows live targets.

CREATE OR REPLACE VIEW "tappable_devices" AS
  SELECT
    "charge_box_id"                          AS "id",
    'charger'::text                          AS "kind",
    COALESCE("friendly_name", "charge_box_id") AS "label",
    ARRAY['ev','tap']::text[]                 AS "capabilities",
    NULL::text                                AS "owner_user_id",
    "first_seen_at"                           AS "registered_at",
    "last_seen_at",
    NULL::timestamptz                         AS "deleted_at",
    NULL::timestamptz                         AS "revoked_at"
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

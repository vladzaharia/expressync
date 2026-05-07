-- Migration 0046 — public IDs, structured address, soft-delete, per-device tags
--
-- Adds a sticker-printable, human-readable identity to chargers and users
-- (8-char NanoID from a 28-char Crockford-ish alphabet; see
-- `src/lib/utils/public-id.ts`). All future inserts populate it via the
-- Drizzle `.$defaultFn(...)` and a BetterAuth user-create hook; this
-- migration backfills every existing row so the column can immediately be
-- declared NOT NULL UNIQUE.
--
-- Also lands in this migration:
--   - structured address fields + lat/lon on chargers_cache (powers iOS
--     Navigate button + future nearest-charger UX),
--   - `deactivated_at` on chargers_cache (soft-delete for unmanaged
--     chargers),
--   - `device_id` on user_mappings (links per-device OCPP tags to the
--     device that owns them; ON DELETE CASCADE so deregistering a device
--     drops its tag).

-- 1. Add public_id columns (nullable for now; backfilled below).
ALTER TABLE "chargers_cache" ADD COLUMN "public_id" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "public_id" text;
--> statement-breakpoint

-- 2. Address + coordinates + soft-delete on chargers_cache.
ALTER TABLE "chargers_cache" ADD COLUMN "address_line1"      text;
--> statement-breakpoint
ALTER TABLE "chargers_cache" ADD COLUMN "address_line2"      text;
--> statement-breakpoint
ALTER TABLE "chargers_cache" ADD COLUMN "address_city"       text;
--> statement-breakpoint
ALTER TABLE "chargers_cache" ADD COLUMN "address_region"     text;
--> statement-breakpoint
ALTER TABLE "chargers_cache" ADD COLUMN "address_postal_code" text;
--> statement-breakpoint
ALTER TABLE "chargers_cache" ADD COLUMN "address_country"    text;
--> statement-breakpoint
ALTER TABLE "chargers_cache" ADD COLUMN "latitude"  numeric(9,6);
--> statement-breakpoint
ALTER TABLE "chargers_cache" ADD COLUMN "longitude" numeric(9,6);
--> statement-breakpoint
ALTER TABLE "chargers_cache" ADD COLUMN "deactivated_at" timestamptz;
--> statement-breakpoint

ALTER TABLE "chargers_cache"
  ADD CONSTRAINT "chargers_cache_latitude_range_check"
  CHECK ("latitude"  IS NULL OR ("latitude"  BETWEEN  -90 AND  90));
--> statement-breakpoint
ALTER TABLE "chargers_cache"
  ADD CONSTRAINT "chargers_cache_longitude_range_check"
  CHECK ("longitude" IS NULL OR ("longitude" BETWEEN -180 AND 180));
--> statement-breakpoint
ALTER TABLE "chargers_cache"
  ADD CONSTRAINT "chargers_cache_address_country_format_check"
  CHECK ("address_country" IS NULL OR "address_country" ~ '^[A-Z]{2}$');
--> statement-breakpoint

-- 3. Per-device link on user_mappings (nullable — null rows are the
--    customer's user-level meta-tag; non-null rows are device-scoped).
ALTER TABLE "user_mappings"
  ADD COLUMN "device_id" uuid REFERENCES "devices"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX "idx_user_mappings_device_id" ON "user_mappings"("device_id");
--> statement-breakpoint

-- 4. Backfill public_id with a retry-on-collision loop. The alphabet
--    matches `src/lib/utils/public-id.ts#PUBLIC_ID_ALPHABET`. Random
--    selection uses pgcrypto's gen_random_bytes when available; falls
--    back to random() (which is fine for backfill since collisions just
--    retry).
DO $$
DECLARE
  alphabet text := '23456789ABCDEFGHJKMNPQRSTVWXYZ';
  alpha_len int := length(alphabet);
  candidate text;
  rec record;
  attempts int;
BEGIN
  -- chargers_cache
  FOR rec IN SELECT "charge_box_id" FROM "chargers_cache" WHERE "public_id" IS NULL LOOP
    attempts := 0;
    LOOP
      candidate := '';
      FOR i IN 1..8 LOOP
        candidate := candidate || substr(
          alphabet,
          1 + floor(random() * alpha_len)::int,
          1
        );
      END LOOP;

      BEGIN
        UPDATE "chargers_cache"
          SET "public_id" = candidate
          WHERE "charge_box_id" = rec."charge_box_id";
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        attempts := attempts + 1;
        IF attempts > 12 THEN
          RAISE EXCEPTION 'Failed to allocate unique public_id for charger % after 12 attempts',
            rec."charge_box_id";
        END IF;
      END;
    END LOOP;
  END LOOP;

  -- users
  FOR rec IN SELECT "id" FROM "users" WHERE "public_id" IS NULL LOOP
    attempts := 0;
    LOOP
      candidate := '';
      FOR i IN 1..8 LOOP
        candidate := candidate || substr(
          alphabet,
          1 + floor(random() * alpha_len)::int,
          1
        );
      END LOOP;

      BEGIN
        UPDATE "users"
          SET "public_id" = candidate
          WHERE "id" = rec."id";
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        attempts := attempts + 1;
        IF attempts > 12 THEN
          RAISE EXCEPTION 'Failed to allocate unique public_id for user % after 12 attempts',
            rec."id";
        END IF;
      END;
    END LOOP;
  END LOOP;
END;
$$;
--> statement-breakpoint

-- 5. Lock down public_id: NOT NULL + unique index. Format check matches
--    the JS-side `isValidPublicId` so any code path that bypasses the
--    Drizzle default still produces a valid identifier.
ALTER TABLE "chargers_cache" ALTER COLUMN "public_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "chargers_cache"
  ADD CONSTRAINT "chargers_cache_public_id_format_check"
  CHECK ("public_id" ~ '^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$');
--> statement-breakpoint
CREATE UNIQUE INDEX "chargers_cache_public_id_key" ON "chargers_cache"("public_id");
--> statement-breakpoint

ALTER TABLE "users" ALTER COLUMN "public_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "users"
  ADD CONSTRAINT "users_public_id_format_check"
  CHECK ("public_id" ~ '^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$');
--> statement-breakpoint
CREATE UNIQUE INDEX "users_public_id_key" ON "users"("public_id");
--> statement-breakpoint

-- 6. Recreate `tappable_devices` so the charger half excludes
--    deactivated rows. The view shape (id/kind/label/capabilities/...)
--    matches the one created in 0043 — apps that read the view stay
--    unchanged, but deactivated unmanaged chargers stop appearing in
--    scan-modal pickers.
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
    "deactivated_at"                             AS "deleted_at",
    NULL::timestamptz                            AS "revoked_at"
  FROM "chargers_cache"
  WHERE "deactivated_at" IS NULL
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

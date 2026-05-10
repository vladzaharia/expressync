-- Migration 0051 — user + device feature-flag tables.
--
-- Two new tables for runtime feature toggles (per-user values, with
-- optional per-device overrides). Mirrors the `device_settings`
-- composite-PK + JSONB + LWW-metadata shape, but separated so:
--
--   * Flags are admin-write-only (devices can't push flag values via
--     the existing pendingSettings rail). Keeping flags in their own
--     tables keeps the LWW merge for `device_settings` strictly about
--     user-edited preferences.
--   * Charger-kind devices are forbidden from carrying flags. A
--     trigger (mirroring the `trg_devices_owner_role` style from
--     migration 0034) raises on INSERT/UPDATE when the target device
--     is not a phone/tablet/laptop. Defense in depth: the application
--     layer (`src/lib/devices/feature-flag-resolver.ts`) also skips
--     the device-override read for charger rows.
--
-- Effective-value precedence (resolver):
--   device_override ?? user_value ?? registry.defaultValue
--
-- The application's flag registry (`src/lib/devices/feature-flags.ts`)
-- enumerates every legal flag_key. We deliberately do NOT pin the
-- allowed keys with a CHECK constraint — adding/removing a flag must
-- not require a migration, and stale rows are harmless (the resolver
-- simply ignores any key not in the registry).

-- Step 1: per-user flag values.
CREATE TABLE IF NOT EXISTS "user_feature_flag_values" (
  "user_id"     TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "flag_key"    TEXT NOT NULL,
  "value_json"  JSONB NOT NULL,
  "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_by"  TEXT NOT NULL,
  PRIMARY KEY ("user_id", "flag_key")
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_user_feature_flag_values_updated_at"
  ON "user_feature_flag_values" ("user_id", "updated_at" DESC);
--> statement-breakpoint

-- Step 2: per-device flag overrides.
CREATE TABLE IF NOT EXISTS "device_feature_flag_overrides" (
  "device_id"   UUID NOT NULL REFERENCES "devices"("id") ON DELETE CASCADE,
  "flag_key"    TEXT NOT NULL,
  "value_json"  JSONB NOT NULL,
  "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_by"  TEXT NOT NULL,
  PRIMARY KEY ("device_id", "flag_key")
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_device_feature_flag_overrides_updated_at"
  ON "device_feature_flag_overrides" ("device_id", "updated_at" DESC);
--> statement-breakpoint

-- Step 3: trigger — only phone/tablet/laptop devices may carry flag
-- overrides. Mirrors the `devices_owner_must_be_admin` /
-- `trg_devices_owner_role` shape from migration 0034. The allowlist
-- mirrors `devices.kind` CHECK in 0034 (today the universe of
-- non-charger devices in `devices` is exactly these three kinds, but
-- we list explicitly so a future kind that should be excluded fails
-- closed).
CREATE OR REPLACE FUNCTION device_feature_flag_overrides_phone_only()
RETURNS TRIGGER AS $$
DECLARE
  k text;
BEGIN
  SELECT kind INTO k FROM devices WHERE id = NEW.device_id;
  IF k IS NULL THEN
    RAISE EXCEPTION
      'device_feature_flag_overrides: device % does not exist', NEW.device_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF k NOT IN ('phone_nfc','tablet_nfc','laptop_nfc') THEN
    RAISE EXCEPTION
      'device_feature_flag_overrides: device kind=% cannot carry feature flags (phones/tablets/laptops only)', k
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_device_feature_flag_overrides_phone_only
  ON "device_feature_flag_overrides";
--> statement-breakpoint
CREATE TRIGGER trg_device_feature_flag_overrides_phone_only
  BEFORE INSERT OR UPDATE OF device_id ON "device_feature_flag_overrides"
  FOR EACH ROW EXECUTE FUNCTION device_feature_flag_overrides_phone_only();

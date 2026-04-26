-- Polaris Track A — devices + device_tokens tables (Wave 1, ExpresScan).
--
-- New tables for the iPhone (and future) NFC reader devices. Chargers
-- continue to live in `chargers_cache`; this table is additive — the
-- `tappable_devices` view in 0035 unions both into one tap-target list.
--
-- Owner-role enforcement: `devices.owner_user_id` MUST reference a user
-- with role='admin'. Mirrors migration 0018's customer-only trigger on
-- `user_mappings`. Defense in depth: the registration handler also gates
-- on session role, but a constraint violation here is the durable invariant.

CREATE TABLE IF NOT EXISTS "devices" (
  "id"                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "kind"               TEXT NOT NULL CHECK (kind IN ('phone_nfc','laptop_nfc')),
  "label"              TEXT NOT NULL,
  "capabilities"       TEXT[] NOT NULL DEFAULT ARRAY['tap'],
  "owner_user_id"      TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "platform"           TEXT NOT NULL,
  "model"              TEXT NOT NULL,
  "os_version"         TEXT NOT NULL,
  "app_version"        TEXT NOT NULL,
  "push_token"         TEXT,
  "apns_environment"   TEXT CHECK (apns_environment IN ('sandbox','production')),
  "last_seen_at"       TIMESTAMPTZ,
  "last_status"        JSONB,
  "registered_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "deleted_at"         TIMESTAMPTZ,
  "revoked_at"         TIMESTAMPTZ,
  "revoked_by_user_id" TEXT REFERENCES "users"("id") ON DELETE SET NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_devices_owner_last_seen"
  ON "devices" ("owner_user_id", "last_seen_at" DESC) WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_devices_capabilities"
  ON "devices" USING GIN ("capabilities") WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_devices_last_seen"
  ON "devices" ("last_seen_at" DESC) WHERE "deleted_at" IS NULL;
--> statement-breakpoint

-- Defense-in-depth: only admin users may own a device. Mirrors migration
-- 0018's pattern for `user_mappings.user_id` → customer-only.
CREATE OR REPLACE FUNCTION devices_owner_must_be_admin()
RETURNS TRIGGER AS $$
DECLARE
  r text;
BEGIN
  IF NEW.owner_user_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT role INTO r FROM users WHERE id = NEW.owner_user_id;
  IF r IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION
      'devices.owner_user_id must reference a user with role=admin (got role=%)', r
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_devices_owner_role ON "devices";
--> statement-breakpoint
CREATE TRIGGER trg_devices_owner_role
  BEFORE INSERT OR UPDATE OF owner_user_id ON "devices"
  FOR EACH ROW EXECUTE FUNCTION devices_owner_must_be_admin();
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "device_tokens" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "device_id"    UUID NOT NULL REFERENCES "devices"("id") ON DELETE CASCADE,
  "token_hash"   TEXT NOT NULL UNIQUE,
  "secret_hash"  TEXT NOT NULL,
  "expires_at"   TIMESTAMPTZ NOT NULL,
  "revoked_at"   TIMESTAMPTZ,
  "last_used_at" TIMESTAMPTZ,
  "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_device_tokens_hash"
  ON "device_tokens" ("token_hash") WHERE "revoked_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_device_tokens_device"
  ON "device_tokens" ("device_id", "created_at" DESC);

-- ExpresScan v2 / Wave 6 Slice B —
-- `device_settings` table + kiosk-legality CHECK on `devices.capabilities`.
--
-- Two changes in this migration:
--
-- 1. Create `device_settings` (deviceId, key, valueJson, updatedAt, updatedBy)
--    with a composite primary key on (deviceId, key) — one row per key per
--    device — and a (deviceId, updatedAt DESC) index for the upcoming
--    `GET /api/devices/me/state` envelope reader (slice C).
--
--    `valueJson` is JSONB so per-key value shapes can be primitives,
--    objects, or arrays. The per-key Zod registry in
--    `src/lib/devices/settings-keys.ts` constrains shapes at the
--    application boundary — DB stays schema-flexible to absorb new
--    setting keys without migrations.
--
--    Per-key Last-Writer-Wins is the wire-protocol contract; the table
--    only stores the post-merge value plus its provenance. See
--    `src/lib/devices/lww.ts` for the merge algorithm.
--
-- 2. Add a kiosk-legality CHECK constraint on `devices.capabilities`.
--    The application-side validator in `src/lib/devices/capability-gate.ts`
--    enforces the same rule, but having the invariant at the DB level
--    means a forgotten call site (or a manual SQL update) can't slip an
--    illegal kiosk row through. Rule:
--
--      'kiosk' = ANY(capabilities) ⟹ exactly one of {scanner, user}
--                                     is also present.
--
--    Implemented by counting the cardinality of the intersection of
--    `capabilities` with `{scanner, user}` and asserting it equals 1
--    when `kiosk` is present.

-- Step 1: device_settings table.
CREATE TABLE IF NOT EXISTS "device_settings" (
  "device_id"   UUID NOT NULL REFERENCES "devices"("id") ON DELETE CASCADE,
  "key"         TEXT NOT NULL,
  "value_json"  JSONB NOT NULL,
  "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_by"  TEXT NOT NULL,
  PRIMARY KEY ("device_id", "key")
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_device_settings_updated_at"
  ON "device_settings" ("device_id", "updated_at" DESC);
--> statement-breakpoint

-- Step 2: kiosk-legality CHECK constraint on devices.capabilities.
--
-- We scope the CHECK to the kiosk case so app-side rows without `kiosk`
-- are unaffected. The "exactly one of {scanner, user}" rule is encoded
-- as a boolean XOR over the two membership checks — that keeps the
-- constraint expressible without a subquery (Postgres rejects
-- subqueries in CHECK).
ALTER TABLE "devices"
  ADD CONSTRAINT "devices_kiosk_legality_check"
  CHECK (
    NOT ('kiosk' = ANY("capabilities"))
    OR (
      ('scanner' = ANY("capabilities"))
      <> ('user' = ANY("capabilities"))
    )
  );

-- ExpressCharge / Wave 6 — admin-editable connector + max-kW overrides on
-- chargers_cache.
--
-- Why:
--   StEvE doesn't reliably surface the connector type or the AC kW rating
--   on every OCPP charger model — vendors put either nothing or a wrong
--   value into the `BootNotification` payload. Without an override the iOS
--   detail screen and the admin charger card render `—` for both fields,
--   and there's no way to correct a misreport short of editing the wire
--   model. These two columns let an operator pin the canonical values.
--
-- Changes:
--   1. Add `chargers_cache.connector_type_override text NULL` —
--      one of {ccs, j1772, nacs, chademo, type2}.
--   2. Add `chargers_cache.max_kw_override numeric(6, 2) NULL` —
--      a positive AC or DC rating in kW. Stored as numeric so a
--      Wallbox 11.5 kW reads cleanly without floating-point hash.
--   3. CHECK constraints pin both columns to sensible domains.
--
-- Backwards compatibility:
--   * Existing rows get NULL — the API routes fall back to whatever
--     StEvE reports (or `null` if nothing reported, which is today's
--     status quo).
--   * No view changes — `tappable_devices` doesn't surface either
--     column, so callers reading the cache directly continue to work.
--

ALTER TABLE "chargers_cache"
  ADD COLUMN "connector_type_override" text;
--> statement-breakpoint
ALTER TABLE "chargers_cache"
  ADD COLUMN "max_kw_override" numeric(6, 2);
--> statement-breakpoint
ALTER TABLE "chargers_cache"
  ADD CONSTRAINT "chargers_cache_connector_type_override_check"
  CHECK (
    "connector_type_override" IS NULL
    OR "connector_type_override" IN ('ccs', 'j1772', 'nacs', 'chademo', 'type2')
  );
--> statement-breakpoint
ALTER TABLE "chargers_cache"
  ADD CONSTRAINT "chargers_cache_max_kw_override_check"
  CHECK (
    "max_kw_override" IS NULL
    OR ("max_kw_override" > 0 AND "max_kw_override" <= 1000)
  );

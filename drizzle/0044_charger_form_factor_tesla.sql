-- Add `tesla` to the chargers_cache.form_factor enum.
--
-- Why:
--   Migration 0043 introduced unmanaged chargers, primarily for Tesla
--   Wall Connectors. Until now those rows had to default to `wall_mount`
--   — accurate only by coincidence, and wrong for the icon used in the
--   admin UI and iOS Chargers list. The iOS app already carries a
--   `tesla` enum case and a tall-narrow LED-strip silhouette
--   (`ChargerFormFactorIcon.drawTesla`); the web side now gains the
--   matching SVG (`components/brand/chargers/TeslaIcon.tsx`) and
--   accepts `'tesla'` as a valid form factor.
--
-- Existing rows are untouched — only the CHECK constraint is widened.
-- The unmanaged-charger create flow defaults to `'tesla'` going forward.

ALTER TABLE "chargers_cache"
  DROP CONSTRAINT "chargers_cache_form_factor_check";
--> statement-breakpoint

ALTER TABLE "chargers_cache"
  ADD CONSTRAINT "chargers_cache_form_factor_check"
  CHECK ("form_factor" IN ('wallbox','pulsar','commander','wall_mount','tesla','generic'));

-- Consolidate `chargers_cache.form_factor` to three values: wallbox,
-- tesla, generic. Pulsar / Commander / Wall mount were always rendered
-- with the same wallbox silhouette in both the iOS app and the web
-- admin (see `drawWallbox` in
-- ExpresScan/App/Features/Chargers/ChargerFormFactorIcon.swift) — they
-- carried no real visual or semantic distinction. Collapsing them to
-- `'wallbox'` removes three icons + three labels + three enum branches
-- without losing any user-visible information.
--
-- Existing rows are backfilled to `'wallbox'`. Operators that need to
-- distinguish hardware sub-models can use `friendly_name` / Tesla-side
-- inventory tooling instead.

UPDATE "chargers_cache"
  SET "form_factor" = 'wallbox'
  WHERE "form_factor" IN ('pulsar', 'commander', 'wall_mount');
--> statement-breakpoint

ALTER TABLE "chargers_cache"
  DROP CONSTRAINT "chargers_cache_form_factor_check";
--> statement-breakpoint

ALTER TABLE "chargers_cache"
  ADD CONSTRAINT "chargers_cache_form_factor_check"
  CHECK ("form_factor" IN ('wallbox', 'tesla', 'generic'));

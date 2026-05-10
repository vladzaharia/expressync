-- Migration 0054 — global feature-flag tier.
--
-- Adds a third tier above per-user / per-device for flag values that
-- apply to every consumer in the absence of an override. Effective
-- precedence (resolver) becomes:
--
--   device override > user value > global value > registry default
--
-- Singleton row per `flag_key`. The table is intentionally tiny: a
-- handful of admin-set toggles drive whole-app behaviour without
-- requiring a per-user/per-device sweep first.

CREATE TABLE IF NOT EXISTS "global_feature_flag_values" (
  "flag_key"    TEXT PRIMARY KEY,
  "value_json"  JSONB NOT NULL,
  "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_by"  TEXT NOT NULL
);

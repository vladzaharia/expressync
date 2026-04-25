-- Persisted breaker state for Lago webhook dispatch. Lets the in-process
-- counters survive restarts + multi-replica deploys: every transition
-- writes through to this single row (id=1), and a fresh process hydrates
-- from it at startup.
CREATE TABLE IF NOT EXISTS "lago_webhook_breaker_state" (
  "id" integer PRIMARY KEY,
  "consecutive_failures" integer NOT NULL DEFAULT 0,
  "disabled_until_ms" bigint,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "lago_webhook_breaker_state_singleton" CHECK ("id" = 1)
);

-- Seed the singleton row so subsequent writes can use a plain UPDATE.
INSERT INTO "lago_webhook_breaker_state" ("id", "consecutive_failures", "disabled_until_ms")
VALUES (1, 0, NULL)
ON CONFLICT ("id") DO NOTHING;

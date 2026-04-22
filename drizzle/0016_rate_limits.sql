-- Phase A7a: Postgres-backed rate limiter
--
-- Replaces the in-memory `Map` rate limiter in `src/lib/utils/rate-limit.ts`
-- with a durable, multi-instance-safe table. Each row is a single
-- (key, window_start) bucket; `count` is incremented via UPSERT on every hit.
--
-- Cleanup is handled by a 2-minute cron job in `sync-worker.ts` that deletes
-- rows with `updated_at < now() - interval '120 seconds'`. No retention past
-- one minute is required because RATE_LIMIT_WINDOW_MS is 60s.

CREATE TABLE IF NOT EXISTS "rate_limits" (
  "id" serial PRIMARY KEY NOT NULL,
  "key" text NOT NULL,
  "window_start" timestamp with time zone NOT NULL,
  "count" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "rate_limits_key_window_start_unique"
  ON "rate_limits" ("key", "window_start");

CREATE INDEX IF NOT EXISTS "idx_rate_limits_updated_at"
  ON "rate_limits" ("updated_at");

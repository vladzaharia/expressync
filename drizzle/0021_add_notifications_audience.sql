-- Polaris Track A: notifications targeting (admin vs customer vs broadcast)
--
-- The existing `notifications` table is admin-scoped today. Adding `audience`
-- lets the same table serve customer surfaces too. Existing rows default to
-- 'admin' so nothing in the admin feed leaks to customer surfaces post-deploy.
--
-- Audience semantics:
--   admin    — admin operators only (existing behavior)
--   customer — a single customer (use admin_user_id to scope to their user_id)
--   all      — broadcast to every authenticated session (rare; system-wide)

ALTER TABLE "notifications" ADD COLUMN "audience" text NOT NULL DEFAULT 'admin'
  CHECK (audience IN ('admin', 'customer', 'all'));

CREATE INDEX IF NOT EXISTS "idx_notifications_audience"
  ON "notifications" ("audience");

-- Phase P4: Webhook replay tracking
--
-- Adds three columns to `lago_webhook_events` so we can trace replay lineage:
--   * replayed_from_id     - original row id when this event is a replay
--   * replayed_at          - when the replay was triggered
--   * replayed_by_user_id  - admin who triggered the replay
--
-- Original rows keep NULLs; replay rows point back at their source. Cascade
-- rules follow existing conventions (SET NULL so the audit trail survives
-- the deletion of either the source event or the triggering admin).
--
-- Partial index targets the hot query: "show me all replays of event N".

ALTER TABLE "lago_webhook_events"
  ADD COLUMN IF NOT EXISTS "replayed_from_id" INTEGER
    REFERENCES "lago_webhook_events"("id") ON DELETE SET NULL;

ALTER TABLE "lago_webhook_events"
  ADD COLUMN IF NOT EXISTS "replayed_at" TIMESTAMPTZ;

ALTER TABLE "lago_webhook_events"
  ADD COLUMN IF NOT EXISTS "replayed_by_user_id" TEXT
    REFERENCES "users"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "idx_lago_webhook_events_replayed_from"
  ON "lago_webhook_events" ("replayed_from_id")
  WHERE "replayed_from_id" IS NOT NULL;

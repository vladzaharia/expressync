-- Phase P1 (Phase K): Notifications table
-- Replaces the `notify()` stub in lago-webhook-handler.service.ts with a real
-- in-app notification backing store. MVP broadcasts to all admins by leaving
-- admin_user_id NULL; per-user routing is a post-MVP iteration.
--
-- Severity is constrained via CHECK to match the UI's NotificationSeverityDot
-- mapping (info/success/warn/error → sky/emerald/amber/rose).
--
-- Indexes optimize the two hot paths:
--   1. Unread badge / bell dropdown — partial index on unread+undismissed rows
--      sorted by creation time.
--   2. Source linking — chip renders need (source_type, source_id) lookup when
--      the referenced entity is loaded (e.g. is this invoice archived?).

CREATE TABLE "notifications" (
  "id" serial PRIMARY KEY NOT NULL,
  "kind" text NOT NULL,
  "severity" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "source_type" text,
  "source_id" text,
  "context" jsonb,
  "admin_user_id" text REFERENCES "users"("id") ON DELETE CASCADE,
  "read_at" timestamptz,
  "dismissed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "notifications_severity_check"
    CHECK ("severity" IN ('info', 'success', 'warn', 'error'))
);
--> statement-breakpoint
CREATE INDEX "idx_notifications_unread_feed" ON "notifications" (
  "admin_user_id",
  "created_at" DESC
) WHERE "read_at" IS NULL AND "dismissed_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "idx_notifications_source" ON "notifications" (
  "source_type",
  "source_id"
);
--> statement-breakpoint
CREATE INDEX "idx_notifications_created_at" ON "notifications" (
  "created_at" DESC
);

-- Phase C: adaptive sync cadence
-- Singleton row (id = 1) holds the scheduler's current tier + evaluation state.
CREATE TABLE "sync_schedule_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"current_tier" text DEFAULT 'idle' NOT NULL,
	"last_activity_at" timestamptz,
	"last_evaluated_at" timestamptz,
	"next_run_at" timestamptz,
	"consecutive_idle_ticks" integer DEFAULT 0 NOT NULL,
	"pinned_until" timestamptz,
	"pinned_tier" text,
	CONSTRAINT "sync_schedule_state_singleton" CHECK ("id" = 1),
	CONSTRAINT "sync_schedule_state_current_tier_check" CHECK ("current_tier" IN ('active','idle','dormant')),
	CONSTRAINT "sync_schedule_state_pinned_tier_check" CHECK ("pinned_tier" IN ('active','idle','dormant'))
);--> statement-breakpoint
INSERT INTO "sync_schedule_state" ("id", "current_tier") VALUES (1, 'idle') ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Append-only log of tag change events (detected in tag-sync.service before StEvE write).
-- Drives the "was there any activity in the last 30 days" signal for the scheduler.
CREATE TABLE "tag_change_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"ocpp_tag_pk" integer,
	"id_tag" text NOT NULL,
	"change_type" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"detected_at" timestamptz DEFAULT now() NOT NULL,
	"sync_run_id" integer
);--> statement-breakpoint
ALTER TABLE "tag_change_log" ADD CONSTRAINT "tag_change_log_sync_run_id_sync_runs_id_fk" FOREIGN KEY ("sync_run_id") REFERENCES "public"."sync_runs"("id") ON DELETE SET NULL ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_tag_change_log_detected_at" ON "tag_change_log" ("detected_at" DESC);

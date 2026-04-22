-- Phase B: chargers cache
-- Sticky list of known chargers, derived from StEvE transactions + charger_operation_log.
-- Refreshed at the end of every sync run; last_status/last_status_at updated on TriggerMessage replies.
CREATE TABLE "chargers_cache" (
	"charge_box_id" text PRIMARY KEY NOT NULL,
	"charge_box_pk" integer,
	"friendly_name" text,
	"form_factor" text DEFAULT 'wallbox' NOT NULL,
	"first_seen_at" timestamptz DEFAULT now() NOT NULL,
	"last_seen_at" timestamptz DEFAULT now() NOT NULL,
	"last_status" text,
	"last_status_at" timestamptz,
	CONSTRAINT "chargers_cache_form_factor_check" CHECK ("form_factor" IN ('wallbox','pulsar','commander','wall_mount','generic'))
);--> statement-breakpoint
CREATE INDEX "idx_chargers_cache_last_seen" ON "chargers_cache" ("last_seen_at" DESC);

-- Phase D: Lago webhook audit table
-- Append-only log of every Lago webhook payload we receive. Dispatch happens
-- after persistence so nothing is ever lost even if the discriminated-union
-- handler throws. `processed_at` and `processing_error` are updated in place
-- after dispatch completes.
CREATE TABLE "lago_webhook_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"webhook_type" text NOT NULL,
	"object_type" text,
	"lago_object_id" text,
	"external_customer_id" text,
	"external_subscription_id" text,
	"raw_payload" jsonb NOT NULL,
	"received_at" timestamptz NOT NULL DEFAULT now(),
	"processed_at" timestamptz,
	"processing_error" text,
	"notification_fired" boolean NOT NULL DEFAULT false
);--> statement-breakpoint
CREATE INDEX "idx_lago_webhook_events_type_received" ON "lago_webhook_events" ("webhook_type", "received_at" DESC);--> statement-breakpoint
CREATE INDEX "idx_lago_webhook_events_customer_received" ON "lago_webhook_events" ("external_customer_id", "received_at" DESC);

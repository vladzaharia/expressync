CREATE TABLE "sync_run_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"sync_run_id" integer NOT NULL,
	"segment" text NOT NULL,
	"level" text DEFAULT 'info' NOT NULL,
	"message" text NOT NULL,
	"context" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sync_runs" ADD COLUMN "tag_linking_status" text;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD COLUMN "transaction_sync_status" text;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD COLUMN "tags_validated" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD COLUMN "tags_with_issues" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "sync_run_logs" ADD CONSTRAINT "sync_run_logs_sync_run_id_sync_runs_id_fk" FOREIGN KEY ("sync_run_id") REFERENCES "public"."sync_runs"("id") ON DELETE cascade ON UPDATE no action;
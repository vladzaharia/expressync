ALTER TABLE "sync_runs" ADD COLUMN "tags_activated" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD COLUMN "tags_deactivated" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD COLUMN "tags_unchanged" integer DEFAULT 0;
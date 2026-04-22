-- H15: Add missing database indexes
CREATE INDEX "idx_sync_runs_status" ON "sync_runs" ("status");--> statement-breakpoint
CREATE INDEX "idx_sync_runs_started_at" ON "sync_runs" ("started_at");--> statement-breakpoint
CREATE INDEX "idx_sync_run_logs_sync_run_id_created_at" ON "sync_run_logs" ("sync_run_id", "created_at");--> statement-breakpoint
CREATE INDEX "idx_synced_transaction_events_sync_run_id" ON "synced_transaction_events" ("sync_run_id");--> statement-breakpoint
CREATE INDEX "idx_synced_transaction_events_steve_transaction_id" ON "synced_transaction_events" ("steve_transaction_id");--> statement-breakpoint
CREATE INDEX "idx_user_mappings_is_active" ON "user_mappings" ("is_active");--> statement-breakpoint
CREATE INDEX "idx_user_mappings_lago_customer_external_id" ON "user_mappings" ("lago_customer_external_id");--> statement-breakpoint

-- M8: Change billing columns from real to numeric(12,6)
ALTER TABLE "transaction_sync_state" ALTER COLUMN "total_kwh_billed" SET DATA TYPE numeric(12, 6);--> statement-breakpoint
ALTER TABLE "synced_transaction_events" ALTER COLUMN "kwh_delta" SET DATA TYPE numeric(12, 6);--> statement-breakpoint

-- M9: Change all timestamp columns to timestamptz (timestamp with time zone)
-- users
ALTER TABLE "users" ALTER COLUMN "created_at" SET DATA TYPE timestamptz;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "updated_at" SET DATA TYPE timestamptz;--> statement-breakpoint
-- sessions
ALTER TABLE "sessions" ALTER COLUMN "expires_at" SET DATA TYPE timestamptz;--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "created_at" SET DATA TYPE timestamptz;--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "updated_at" SET DATA TYPE timestamptz;--> statement-breakpoint
-- accounts
ALTER TABLE "accounts" ALTER COLUMN "access_token_expires_at" SET DATA TYPE timestamptz;--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "refresh_token_expires_at" SET DATA TYPE timestamptz;--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "created_at" SET DATA TYPE timestamptz;--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "updated_at" SET DATA TYPE timestamptz;--> statement-breakpoint
-- verifications
ALTER TABLE "verifications" ALTER COLUMN "expires_at" SET DATA TYPE timestamptz;--> statement-breakpoint
ALTER TABLE "verifications" ALTER COLUMN "created_at" SET DATA TYPE timestamptz;--> statement-breakpoint
ALTER TABLE "verifications" ALTER COLUMN "updated_at" SET DATA TYPE timestamptz;--> statement-breakpoint
-- user_mappings
ALTER TABLE "user_mappings" ALTER COLUMN "created_at" SET DATA TYPE timestamptz;--> statement-breakpoint
ALTER TABLE "user_mappings" ALTER COLUMN "updated_at" SET DATA TYPE timestamptz;--> statement-breakpoint
-- sync_runs
ALTER TABLE "sync_runs" ALTER COLUMN "started_at" SET DATA TYPE timestamptz;--> statement-breakpoint
ALTER TABLE "sync_runs" ALTER COLUMN "completed_at" SET DATA TYPE timestamptz;--> statement-breakpoint
-- sync_run_logs
ALTER TABLE "sync_run_logs" ALTER COLUMN "created_at" SET DATA TYPE timestamptz;--> statement-breakpoint
-- transaction_sync_state
ALTER TABLE "transaction_sync_state" ALTER COLUMN "created_at" SET DATA TYPE timestamptz;--> statement-breakpoint
ALTER TABLE "transaction_sync_state" ALTER COLUMN "updated_at" SET DATA TYPE timestamptz;--> statement-breakpoint
-- synced_transaction_events
ALTER TABLE "synced_transaction_events" ALTER COLUMN "synced_at" SET DATA TYPE timestamptz;

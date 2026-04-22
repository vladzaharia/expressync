CREATE TABLE "charger_operation_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"charge_box_id" text NOT NULL,
	"operation" text NOT NULL,
	"params" jsonb,
	"task_id" integer,
	"requested_by_user_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "charger_operation_log" ADD CONSTRAINT "charger_operation_log_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_charger_operation_log_charge_box_created" ON "charger_operation_log" ("charge_box_id","created_at" DESC);

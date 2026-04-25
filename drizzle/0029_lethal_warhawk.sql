CREATE TABLE IF NOT EXISTS "lago_customers" (
	"lago_id" text PRIMARY KEY NOT NULL,
	"external_id" text NOT NULL,
	"name" text,
	"email" text,
	"currency" text,
	"payload" jsonb NOT NULL,
	"lago_updated_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lago_subscriptions" (
	"lago_id" text PRIMARY KEY NOT NULL,
	"external_id" text NOT NULL,
	"external_customer_id" text,
	"customer_lago_id" text,
	"plan_code" text,
	"status" text,
	"started_at" timestamp with time zone,
	"terminated_at" timestamp with time zone,
	"payload" jsonb NOT NULL,
	"lago_updated_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lago_plans" (
	"lago_id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text,
	"interval" text,
	"amount_cents" integer,
	"currency" text,
	"payload" jsonb NOT NULL,
	"lago_updated_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lago_invoices" (
	"lago_id" text PRIMARY KEY NOT NULL,
	"number" text,
	"external_customer_id" text,
	"status" text,
	"payment_status" text,
	"invoice_type" text,
	"total_amount_cents" integer,
	"currency" text,
	"issuing_date" text,
	"payment_overdue" boolean,
	"payload" jsonb NOT NULL,
	"lago_updated_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lago_fees" (
	"lago_id" text PRIMARY KEY NOT NULL,
	"invoice_lago_id" text,
	"external_subscription_id" text,
	"item_code" text,
	"item_name" text,
	"units" numeric(16, 6),
	"amount_cents" integer,
	"currency" text,
	"payload" jsonb NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lago_wallets" (
	"lago_id" text PRIMARY KEY NOT NULL,
	"external_customer_id" text,
	"status" text,
	"currency" text,
	"balance_cents" integer,
	"payload" jsonb NOT NULL,
	"lago_updated_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lago_billable_metrics" (
	"lago_id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text,
	"aggregation_type" text,
	"field_name" text,
	"recurring" boolean,
	"payload" jsonb NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lago_customers_external_id_unique" ON "lago_customers" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lago_customers_deleted_at" ON "lago_customers" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lago_subscriptions_external_id_unique" ON "lago_subscriptions" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lago_subscriptions_customer" ON "lago_subscriptions" USING btree ("external_customer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lago_subscriptions_status" ON "lago_subscriptions" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lago_subscriptions_deleted_at" ON "lago_subscriptions" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lago_plans_code_unique" ON "lago_plans" USING btree ("code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lago_plans_deleted_at" ON "lago_plans" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lago_invoices_customer" ON "lago_invoices" USING btree ("external_customer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lago_invoices_status" ON "lago_invoices" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lago_invoices_payment_status" ON "lago_invoices" USING btree ("payment_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lago_invoices_deleted_at" ON "lago_invoices" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lago_fees_invoice" ON "lago_fees" USING btree ("invoice_lago_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lago_fees_subscription" ON "lago_fees" USING btree ("external_subscription_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lago_fees_deleted_at" ON "lago_fees" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lago_wallets_customer" ON "lago_wallets" USING btree ("external_customer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lago_wallets_deleted_at" ON "lago_wallets" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lago_billable_metrics_code_unique" ON "lago_billable_metrics" USING btree ("code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_lago_billable_metrics_deleted_at" ON "lago_billable_metrics" USING btree ("deleted_at");

CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"status" text DEFAULT 'running' NOT NULL,
	"transactions_processed" integer DEFAULT 0,
	"events_created" integer DEFAULT 0,
	"errors" text
);
--> statement-breakpoint
CREATE TABLE "synced_transaction_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"steve_transaction_id" integer NOT NULL,
	"transaction_sync_state_id" integer,
	"lago_event_transaction_id" text NOT NULL,
	"user_mapping_id" integer,
	"kwh_delta" real NOT NULL,
	"meter_value_from" integer NOT NULL,
	"meter_value_to" integer NOT NULL,
	"is_final" boolean DEFAULT false,
	"sync_run_id" integer,
	"synced_at" timestamp DEFAULT now(),
	CONSTRAINT "synced_transaction_events_lago_event_transaction_id_unique" UNIQUE("lago_event_transaction_id")
);
--> statement-breakpoint
CREATE TABLE "transaction_sync_state" (
	"id" serial PRIMARY KEY NOT NULL,
	"steve_transaction_id" integer NOT NULL,
	"last_synced_meter_value" integer NOT NULL,
	"total_kwh_billed" real DEFAULT 0,
	"last_sync_run_id" integer,
	"is_finalized" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "transaction_sync_state_steve_transaction_id_unique" UNIQUE("steve_transaction_id")
);
--> statement-breakpoint
CREATE TABLE "user_mappings" (
	"id" serial PRIMARY KEY NOT NULL,
	"steve_ocpp_tag_pk" integer NOT NULL,
	"steve_ocpp_id_tag" text NOT NULL,
	"lago_customer_external_id" text,
	"lago_subscription_external_id" text,
	"display_name" text,
	"notes" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "user_mappings_steve_ocpp_tag_pk_unique" UNIQUE("steve_ocpp_tag_pk")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false,
	"image" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "synced_transaction_events" ADD CONSTRAINT "synced_transaction_events_transaction_sync_state_id_transaction_sync_state_id_fk" FOREIGN KEY ("transaction_sync_state_id") REFERENCES "public"."transaction_sync_state"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "synced_transaction_events" ADD CONSTRAINT "synced_transaction_events_user_mapping_id_user_mappings_id_fk" FOREIGN KEY ("user_mapping_id") REFERENCES "public"."user_mappings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "synced_transaction_events" ADD CONSTRAINT "synced_transaction_events_sync_run_id_sync_runs_id_fk" FOREIGN KEY ("sync_run_id") REFERENCES "public"."sync_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_sync_state" ADD CONSTRAINT "transaction_sync_state_last_sync_run_id_sync_runs_id_fk" FOREIGN KEY ("last_sync_run_id") REFERENCES "public"."sync_runs"("id") ON DELETE no action ON UPDATE no action;
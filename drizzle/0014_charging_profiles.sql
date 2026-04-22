-- Phase P5: Charging Profiles
-- Per-Lago-subscription charging schedule + power cap.
-- Our DB is source of truth; Lago subscription metadata is a best-effort mirror.

CREATE TABLE "charging_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"lago_subscription_external_id" text NOT NULL,
	"preset" text NOT NULL DEFAULT 'unlimited',
	"windows" jsonb NOT NULL DEFAULT '[]'::jsonb,
	"max_w_global" integer,
	"ocpp_charging_profile_id" integer NOT NULL DEFAULT 1,
	"apply_to_active_sessions" boolean DEFAULT false,
	"lago_synced_at" timestamp,
	"lago_sync_error" text,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "charging_profiles_lago_subscription_external_id_unique" UNIQUE("lago_subscription_external_id"),
	CONSTRAINT "charging_profiles_preset_check" CHECK ("preset" IN ('unlimited','offpeak','cap7kw','cap11kw','solar','custom'))
);
--> statement-breakpoint
CREATE INDEX "charging_profiles_subscription_idx" ON "charging_profiles" ("lago_subscription_external_id");
--> statement-breakpoint
ALTER TABLE "charging_profiles" ADD CONSTRAINT "charging_profiles_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "charging_profiles" ADD CONSTRAINT "charging_profiles_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;

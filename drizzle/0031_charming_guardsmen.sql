ALTER TABLE "user_mappings" ADD COLUMN IF NOT EXISTS "steve_parent_id_tag" text;--> statement-breakpoint
ALTER TABLE "user_mappings" ADD COLUMN IF NOT EXISTS "steve_expiry_date" timestamp with time zone;--> statement-breakpoint
-- 0030 already added this; the drizzle meta is out-of-step but the column
-- exists in prod. IF NOT EXISTS keeps this idempotent.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "lago_customer_external_id" text;
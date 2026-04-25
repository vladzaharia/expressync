CREATE TABLE IF NOT EXISTS "idempotency_keys" (
  "key" text PRIMARY KEY NOT NULL,
  "route" text NOT NULL,
  "user_id" text,
  "response_status" integer NOT NULL,
  "response_body" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idempotency_keys_created_at_idx"
  ON "idempotency_keys" ("created_at");

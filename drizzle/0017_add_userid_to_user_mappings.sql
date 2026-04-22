-- Polaris Track A: link customer accounts to user_mappings
--
-- Adds a nullable `user_id` FK from `user_mappings` to `users` so the
-- portal can resolve the customer who owns a given mapping. ON DELETE
-- SET NULL means hard-deleting a customer leaves the mapping admin-visible
-- without orphaning the row (parent record may still reference Lago/StEvE).
--
-- Trigger 0018 enforces that whatever `user_id` is set must reference a row
-- with role='customer' (defense against admin-as-customer mappings).

ALTER TABLE "user_mappings"
  ADD COLUMN "user_id" text REFERENCES "users"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "idx_user_mappings_user_id"
  ON "user_mappings" ("user_id");

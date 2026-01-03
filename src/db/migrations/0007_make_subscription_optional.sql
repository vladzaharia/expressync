-- Migration: Make subscription optional in user_mappings
-- This allows mappings to exist without a subscription, with automatic selection at sync time

-- The subscription field is already nullable in the schema, but we add this migration
-- for documentation and to ensure any existing constraints are removed

-- Remove NOT NULL constraint if it exists (it shouldn't, but just in case)
ALTER TABLE user_mappings ALTER COLUMN lago_subscription_external_id DROP NOT NULL;

-- Add comment explaining the nullable subscription
COMMENT ON COLUMN user_mappings.lago_subscription_external_id IS 
  'Optional subscription ID. If null, the first active subscription for the customer will be used at sync time.';


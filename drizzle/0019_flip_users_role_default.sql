-- Polaris Track A: flip users.role default to 'customer'
--
-- Auto-provisioning creates customer accounts silently when admins link tags
-- (no Better-Auth signUp involved); flipping the default ensures any direct
-- INSERT lacking an explicit role becomes a customer rather than an admin.
-- Admin creation goes through the seed script + admin user-management
-- endpoints, both of which set role='admin' explicitly.
--
-- The CHECK constraint hardens the contract — only the two known roles are
-- ever stored. If a future role is added, this constraint must be updated
-- in lockstep with the trigger from migration 0018.

ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'customer';

-- Drop the constraint if a previous attempt left a partial state.
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE "users" ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'customer'));

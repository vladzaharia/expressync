-- Polaris Track A — allow nullable users.email
--
-- Lago customers MAY have no email (manual onboarding, partial records,
-- legacy data). The auto-provisioner used to reject those entirely; we
-- now create the user row with email=NULL so scan-to-login still works.
-- Magic-link / outbound-email flows skip null-email accounts silently.
--
-- The functional unique index `users_email_lower_unique` (migration 0027)
-- is built on `LOWER(email)` — Postgres treats NULL as distinct in unique
-- indexes by default, so multiple null-email rows coexist safely.
--
-- Better-Auth's email/password sign-in still requires non-null email; that
-- only affects the admin role, where email continues to be set explicitly
-- by the admin-create-user flow. The customer role uses our custom
-- `signInWithUserId` plugin (scan-to-login) which never reads email.

ALTER TABLE users ALTER COLUMN email DROP NOT NULL;

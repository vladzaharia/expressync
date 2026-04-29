-- ExpresScan / Wave 1 Track A — add `id_token` column to `accounts`.
--
-- Why:
--   BetterAuth's generic-OAuth plugin (used for the Pocket ID OIDC
--   provider) writes the OIDC `id_token` to `account.idToken` after a
--   successful callback. Without this column BetterAuth raises
--   `BetterAuthError: The field "idToken" does not exist in the
--   "account" Drizzle schema`, which manifests as the user being
--   bounced back to the login page after a successful round-trip to
--   the IdP — the session is never written.
--
-- Changes:
--   1. Add `accounts.id_token text NULL` — opaque JWT issued by the
--      IdP. Nullable because email/password rows ("credential" provider)
--      never have one.
--
-- Backwards compatibility:
--   * Existing rows get NULL. Email/password rows are unaffected.
--

ALTER TABLE "accounts"
  ADD COLUMN "id_token" text;

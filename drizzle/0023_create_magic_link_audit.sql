-- Polaris Track A: dedicated audit for magic-link request + consume
--
-- Pairs a single hashed token across its issue and consume events so we can
-- detect:
--   - tokens issued but never consumed (unusual user behavior or delivery loss)
--   - tokens consumed from a different IP/UA than they were requested from
--     (potential interception via email forwarding or shared inbox)
--   - request floods against a single email
--
-- Retention: trimmed to 30 days by the sync-worker cleanup cron — shorter
-- than auth_audit because tokens themselves expire in 15 min, and longer
-- retention isn't useful once the token is dead.
-- Email + token are sha256-hashed; raw values are never stored here.

CREATE TABLE "magic_link_audit" (
  "id"              serial PRIMARY KEY,
  "email_hash"      text NOT NULL,
  "token_hash"      text NOT NULL,
  "requested_ip"    text,
  "requested_ua"    text,
  "consumed_ip"     text,
  "consumed_ua"     text,
  "requested_at"    timestamptz NOT NULL DEFAULT now(),
  "consumed_at"     timestamptz
);

CREATE INDEX "idx_magic_link_audit_email"
  ON "magic_link_audit" ("email_hash", "requested_at" DESC);
CREATE INDEX "idx_magic_link_audit_token"
  ON "magic_link_audit" ("token_hash");

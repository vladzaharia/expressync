-- Polaris Track A: append-only audit log for authentication events
--
-- Captures every login, logout, magic-link request/consume, scan-login
-- success/failure, password failure, impersonation start/end, capability
-- denial, and admin-email-collision attempts. Used for:
--   - forensics (who logged in when, from where)
--   - rate-limit forensics
--   - admin investigations of suspected credential reuse
--
-- Retention: trimmed to the last 90 days by the sync-worker cleanup cron.
-- Email is stored as sha256 hash (never plaintext) to avoid leaking the
-- enumeration set if the audit table is exfiltrated.

CREATE TABLE "auth_audit" (
  "id"          serial PRIMARY KEY,
  "event"       text NOT NULL,
  "user_id"     text REFERENCES users(id) ON DELETE SET NULL,
  "email_hash"  text,
  "ip"          text,
  "ua"          text,
  "route"       text,
  "metadata"    jsonb,
  "created_at"  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "idx_auth_audit_event_time"
  ON "auth_audit" ("event", "created_at" DESC);
CREATE INDEX "idx_auth_audit_user"
  ON "auth_audit" ("user_id", "created_at" DESC);

-- Polaris Track A: audit log for admin "view as customer" impersonation
--
-- Each request made under an impersonation session writes one row here so an
-- admin's snooping can be reconstructed after the fact. The middleware also
-- imposes a per-route rate-limit on logging (~1 row/min/route) to prevent
-- bloat on chatty SSE endpoints.
--
-- Both FKs cascade on user delete: if either party is removed, the audit row
-- is removed too. Forensics use cases should snapshot before purge.

CREATE TABLE "impersonation_audit" (
  "id"              serial PRIMARY KEY,
  "admin_user_id"   text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "customer_user_id" text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "route"           text NOT NULL,
  "method"          text NOT NULL,
  "created_at"      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "idx_impersonation_admin"
  ON "impersonation_audit" ("admin_user_id", "created_at" DESC);
CREATE INDEX "idx_impersonation_customer"
  ON "impersonation_audit" ("customer_user_id", "created_at" DESC);

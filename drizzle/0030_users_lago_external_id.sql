-- Migration 0030 — link `users` directly to their Lago customer so the
-- no-email provisioning path is idempotent.
--
-- Problem: `resolveOrCreateCustomerAccount` looked up an existing user via
-- (a) sibling user_mappings with the same lago_customer_external_id, then
-- (b) case-insensitive email match. When BOTH failed (no mapping yet AND
-- Lago customer has no email), `createNoEmailUser` blindly INSERTed. The
-- reconcile loop runs hourly and walks every Lago customer, so every run
-- produced one fresh `users` row per emailless Lago customer — in prod we
-- saw ~24 duplicate rows for 2 Lago customers (hourly × 12h).
--
-- Fix: store the Lago external_id directly on `users` and enforce
-- uniqueness via a partial index. The resolver can now short-circuit on
-- this column before the sibling/email paths, and `createNoEmailUser`
-- becomes genuinely idempotent.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "lago_customer_external_id" text;

-- Partial unique index: only enforces uniqueness for non-null values. Two
-- users with NULL external_id (admin + email-based customer) remain valid.
CREATE UNIQUE INDEX IF NOT EXISTS "users_lago_external_id_unique"
  ON "users" ("lago_customer_external_id")
  WHERE "lago_customer_external_id" IS NOT NULL;

-- Backfill: for every user that already has an active mapping pointing at a
-- single Lago customer, write that external_id onto the user row. Users
-- with multiple distinct external_ids (shouldn't happen — migration 0026's
-- trigger prevents new occurrences) are skipped and will be surfaced by
-- the dedup script.
WITH single AS (
  SELECT m.user_id, MIN(m.lago_customer_external_id) AS external_id
  FROM user_mappings m
  WHERE m.user_id IS NOT NULL
    AND m.lago_customer_external_id IS NOT NULL
  GROUP BY m.user_id
  HAVING COUNT(DISTINCT m.lago_customer_external_id) = 1
)
UPDATE "users" u
SET "lago_customer_external_id" = s.external_id
FROM single s
WHERE u.id = s.user_id
  AND u."lago_customer_external_id" IS NULL;

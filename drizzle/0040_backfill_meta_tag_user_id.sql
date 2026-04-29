-- Migration 0040 — backfill `user_mappings.user_id` for auto-managed
-- `OCPP-{externalId}` meta-tag rows.
--
-- Problem: `ensureCustomerMetaTag` (src/lib/customer-meta-tags.ts) created
-- the meta-tag mapping row without setting `user_id`. Every customer-side
-- query (cards page, sessions, reservations) filters user_mappings by
-- `user_id`, so the meta-tag was silently invisible to scope resolution.
-- This also broke session attribution for remote-started charges that flow
-- through the meta-tag.
--
-- Fix: in the same PR, the upsert now resolves the owner via
-- `users.lago_customer_external_id` and writes `user_id`. This migration
-- repairs existing rows that predate the fix.
--
-- Only fills NULL `user_id`s — never clobbers an admin-set value.

UPDATE "user_mappings" m
SET "user_id" = u.id
FROM "users" u
WHERE m."user_id" IS NULL
  AND m."lago_customer_external_id" IS NOT NULL
  AND u."lago_customer_external_id" = m."lago_customer_external_id"
  AND m."steve_ocpp_id_tag" LIKE 'OCPP-%';

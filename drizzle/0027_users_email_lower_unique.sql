-- Polaris Track A: case-insensitive email uniqueness
--
-- Lago doesn't normalize email casing, so "Alice@x.com" and "alice@x.com"
-- both flow through the auto-provisioner as separate identifiers, producing
-- duplicate `users` rows that fail later flows in confusing ways. The
-- functional unique index over `LOWER(email)` ensures Postgres rejects the
-- duplicate at INSERT time.
--
-- The original `users_email_unique` (case-sensitive) is dropped because
-- keeping both would cause inconsistent INSERT semantics — INSERTing
-- "ALICE@x" would pass the case-sensitive check but fail the case-insensitive
-- one (or vice versa, depending on order).
--
-- Auto-provisioning code MUST use `LOWER(email) = LOWER($1)` for lookups
-- after this lands.

DROP INDEX IF EXISTS users_email_unique;
CREATE UNIQUE INDEX users_email_lower_unique ON users (LOWER(email));

-- Polaris Track A: index for ownership joins on charger_operation_log
--
-- The customer "my recent charger operations" view will join from the user's
-- ID through `requested_by_user_id`. Without this index, every page render
-- would seq-scan the (potentially large) operation log. Index is partial-
-- friendly (lots of NULL rows for system-initiated ops); Postgres handles the
-- nullability gracefully.

CREATE INDEX IF NOT EXISTS idx_charger_op_log_user_id
  ON charger_operation_log (requested_by_user_id);

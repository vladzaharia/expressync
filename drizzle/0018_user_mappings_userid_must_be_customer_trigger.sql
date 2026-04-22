-- Polaris Track A: enforce role='customer' on user_mappings.user_id
--
-- Defense-in-depth invariant: even if app code accidentally tried to link a
-- mapping to an admin user, this BEFORE INSERT/UPDATE trigger raises an
-- exception so the row is never persisted. Customer accounts and admin
-- accounts MUST be separate rows in `users` (per the auth-separation design).

CREATE OR REPLACE FUNCTION assert_user_mapping_userid_is_customer()
RETURNS TRIGGER AS $$
DECLARE
  r text;
BEGIN
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT role INTO r FROM users WHERE id = NEW.user_id;
  IF r IS DISTINCT FROM 'customer' THEN
    RAISE EXCEPTION
      'user_mappings.user_id must reference a customer (got role=%)', r
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_mappings_userid_role ON user_mappings;
CREATE TRIGGER trg_user_mappings_userid_role
  BEFORE INSERT OR UPDATE OF user_id ON user_mappings
  FOR EACH ROW EXECUTE FUNCTION assert_user_mapping_userid_is_customer();

-- Polaris Track A: enforce one customer per Lago customer
--
-- The auto-provisioning algorithm derives the user from
-- `lago_customer_external_id` via a sibling lookup. If a manual SQL fix or
-- a concurrent race ever resulted in two `user_mappings` rows pointing at the
-- SAME Lago customer but DIFFERENT user_ids, the customer's view of their
-- own data would silently fragment (some sessions visible, others not).
--
-- This trigger blocks any INSERT/UPDATE that would create such a fork.
-- The check ignores rows with `user_id IS NULL` (deferred-link state) and
-- ignores the row being updated itself (so updating the same row's other
-- columns doesn't trip the check).

CREATE OR REPLACE FUNCTION assert_user_mapping_lago_user_consistency()
RETURNS TRIGGER AS $$
DECLARE
  existing_user_id text;
BEGIN
  IF NEW.user_id IS NULL OR NEW.lago_customer_external_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT user_id INTO existing_user_id
    FROM user_mappings
    WHERE lago_customer_external_id = NEW.lago_customer_external_id
      AND user_id IS NOT NULL
      AND user_id <> NEW.user_id
      AND id <> COALESCE(NEW.id, -1)
    LIMIT 1;
  IF existing_user_id IS NOT NULL THEN
    RAISE EXCEPTION
      'user_mappings: lago_customer_external_id=% already linked to user_id=%; refusing to assign user_id=%',
      NEW.lago_customer_external_id, existing_user_id, NEW.user_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_mappings_lago_user_consistency ON user_mappings;
CREATE TRIGGER trg_user_mappings_lago_user_consistency
  BEFORE INSERT OR UPDATE OF user_id, lago_customer_external_id ON user_mappings
  FOR EACH ROW EXECUTE FUNCTION assert_user_mapping_lago_user_consistency();

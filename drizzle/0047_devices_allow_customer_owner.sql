-- Migration 0047 — relax devices.owner_user_id trigger to allow
-- customer accounts.
--
-- Background:
--   Migration 0034 introduced `trg_devices_owner_role` which enforced
--   that `devices.owner_user_id` reference a user with role='admin'.
--   That made sense in Wave 1 when only admins ran the iOS NFC scanner
--   reader. Wave W13 introduces customer-owned devices via the iOS-only
--   QR sign-in flow — a customer scans their card, the iOS app
--   completes registration with `capabilities = ['user']` and the
--   device row's owner is the customer themselves.
--
-- Replacement invariant:
--   role IN ('admin', 'customer'). The role enum is the closed set
--   `{admin, customer}` (CHECK on users.role); rejecting other values
--   is no longer load-bearing since the enum has no third option.

CREATE OR REPLACE FUNCTION devices_owner_must_be_admin()
RETURNS TRIGGER AS $$
DECLARE
  r text;
BEGIN
  IF NEW.owner_user_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT role INTO r FROM users WHERE id = NEW.owner_user_id;
  IF r NOT IN ('admin', 'customer') THEN
    RAISE EXCEPTION
      'devices.owner_user_id must reference a user with role IN (admin, customer) (got role=%)', r
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

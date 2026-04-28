-- 0036 — broaden devices.kind CHECK to allow `tablet_nfc`.
--
-- Only iPhones can register today, but the admin UI now ships a tablet
-- icon and filter so iPad-class scanners can land later without a UI
-- sweep. Replace the existing CHECK so future tablet inserts are
-- accepted; existing rows are unaffected.
ALTER TABLE devices DROP CONSTRAINT IF EXISTS devices_kind_check;
ALTER TABLE devices
  ADD CONSTRAINT devices_kind_check
  CHECK (kind IN ('phone_nfc','tablet_nfc','laptop_nfc'));

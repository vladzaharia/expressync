-- Migration 0052: Phase 2 Bundle 2a — managed capability + last-known
-- location columns for managed-fleet devices.
--
-- Capabilities are stored as a `text[]` on `devices.capabilities` —
-- adding the new `managed` token requires no DDL beyond updating the
-- TypeScript const at `src/lib/types/devices.ts` (which the
-- capabilities-toggle endpoint reads). The migration only adds the
-- four location columns + their index; a future application-level
-- check rejects `managed` for customer-role accounts.
--
-- Battery posture: iOS uses `startMonitoringSignificantLocationChanges()`
-- against the existing When-In-Use grant. NO `UIBackgroundModes/location`
-- is added on the iOS side — sig-change with When-In-Use is sufficient.
--
-- Privacy: location upload is gated by both `managed` capability AND
-- the `device.location.upload` feature flag. Customer-account devices
-- can never receive `managed` so they can never upload.

ALTER TABLE devices
  ADD COLUMN last_location_lat        double precision,
  ADD COLUMN last_location_lon        double precision,
  ADD COLUMN last_location_accuracy_m real,
  ADD COLUMN last_location_at         timestamptz;

CREATE INDEX devices_last_location_at_idx
  ON devices(last_location_at) WHERE last_location_at IS NOT NULL;

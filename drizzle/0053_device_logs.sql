-- Migration 0053: Phase 3c — Structured device-log ingest.
--
-- One row per OTel-shaped log record shipped from a device via the
-- /api/devices/me/state/sync envelope. The wire format is the
-- OpenTelemetry Logs Data Model — see docs/logging/contract.md and
-- the iOS-side `Sources/DeviceLogging/OTelLogRecord.swift`.
--
-- Idempotency:  PRIMARY KEY (device_id, seq) lets the sync route bulk-
--               insert with `ON CONFLICT DO NOTHING`. `seq` is the
--               per-device monotonic UInt64 expressync.seq. We store
--               it as numeric(20,0) because UInt64 doesn't fit in
--               PostgreSQL bigint (signed, max 9.2e18).
--
-- Retention:    7 days hot, pruned every 6 h by the
--               device_logs_retention_prune cron added to
--               sync-worker.ts in this slice.

CREATE TABLE IF NOT EXISTS device_logs (
  device_id        uuid           NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  seq              numeric(20,0)  NOT NULL,
  timestamp_ns     bigint         NOT NULL,
  observed_ts      timestamptz    NOT NULL DEFAULT now(),
  severity_text    text           NOT NULL,
  severity_number  smallint       NOT NULL,
  body             text           NOT NULL,
  category         text,
  trace_id         text,
  span_id          text,
  attributes       jsonb          NOT NULL DEFAULT '{}'::jsonb,
  resource         jsonb          NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (device_id, seq)
);

-- Primary admin query: "logs for device X, newest first, optionally
-- filtered by severity / category / time".
CREATE INDEX IF NOT EXISTS device_logs_device_observed_idx
  ON device_logs (device_id, observed_ts DESC);

CREATE INDEX IF NOT EXISTS device_logs_device_severity_idx
  ON device_logs (device_id, severity_number, observed_ts DESC);

CREATE INDEX IF NOT EXISTS device_logs_device_category_idx
  ON device_logs (device_id, category, observed_ts DESC);

-- Selective attribute search; jsonb_path_ops gives smaller indexes than
-- the default jsonb_ops since we only need the @> containment operator.
CREATE INDEX IF NOT EXISTS device_logs_attributes_gin
  ON device_logs USING gin (attributes jsonb_path_ops);

-- Retention prune walks by observed_ts; standalone btree is cheap and
-- covers DELETE batches.
CREATE INDEX IF NOT EXISTS device_logs_observed_ts_idx
  ON device_logs (observed_ts);

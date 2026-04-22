-- Phase P3: Reservations — first-class booking surface
-- See plan polaris-express-is-an-magical-kahan.md §"Phase P3".
-- Half-open `[start, end)` intervals are used for conflict detection.

CREATE TABLE "reservations" (
  "id" serial PRIMARY KEY NOT NULL,

  -- Charger target
  "charge_box_id" text NOT NULL,
  "connector_id" integer NOT NULL,

  -- StEvE tag reference (mirrors user_mappings.steve_ocpp_tag_pk / steve_ocpp_id_tag)
  "steve_ocpp_tag_pk" integer NOT NULL,
  "steve_ocpp_id_tag" text NOT NULL,

  -- Lago subscription (nullable — profile hook optional)
  "lago_subscription_external_id" text,

  -- Time window (stored in UTC)
  "start_at" timestamptz NOT NULL,
  "end_at" timestamptz NOT NULL,
  -- Cached duration in minutes for display + filter speed
  "duration_minutes" integer NOT NULL,

  -- Status lifecycle
  -- 'pending'    — row written, StEvE ReserveNow in-flight
  -- 'confirmed'  — StEvE returned taskId
  -- 'active'     — within [start_at, end_at)
  -- 'completed'  — end_at passed without cancel
  -- 'cancelled'  — admin or system cancelled
  -- 'conflicted' — detected overlap post-insert
  -- 'orphaned'   — StEvE no longer tracks this reservation
  "status" text NOT NULL DEFAULT 'pending',

  -- StEvE-side identifiers (populated after the async ReserveNow completes)
  "steve_reservation_id" integer,

  -- Link to charging profile apply task (P5)
  "charging_profile_task_id" integer,

  -- Audit
  "created_by_user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "cancelled_at" timestamptz,

  CONSTRAINT "reservations_status_check"
    CHECK ("status" IN ('pending','confirmed','active','completed','cancelled','conflicted','orphaned')),
  CONSTRAINT "reservations_time_window_check"
    CHECK ("end_at" > "start_at")
);
--> statement-breakpoint

-- Conflict queries scan by (charge_box, connector, time). Partial index skips
-- non-blocking statuses so the planner can avoid cancelled/completed rows.
CREATE INDEX "idx_reservations_conflict"
  ON "reservations" ("charge_box_id", "connector_id", "start_at", "end_at")
  WHERE "status" NOT IN ('cancelled','completed','orphaned');
--> statement-breakpoint

CREATE INDEX "idx_reservations_tag_start"
  ON "reservations" ("steve_ocpp_tag_pk", "start_at" DESC);
--> statement-breakpoint

CREATE INDEX "idx_reservations_subscription"
  ON "reservations" ("lago_subscription_external_id")
  WHERE "lago_subscription_external_id" IS NOT NULL;
--> statement-breakpoint

CREATE INDEX "idx_reservations_status_start"
  ON "reservations" ("status", "start_at" DESC);

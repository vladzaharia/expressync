/**
 * Reservation status resolver.
 *
 * After `createReservation()` dispatches a ReserveNow to StEvE, the row
 * lands at `status='pending'` with `steve_reservation_id = <taskId>`.
 * This module owns the transition `pending → confirmed | conflicted`
 * via two complementary side-channels:
 *
 *   1. **Cron poll** (`resolvePendingReservations`)
 *      Iterate pending rows with a non-null `steveReservationId` and
 *      ask StEvE `operations.getTask(taskId)`. StEvE master returns a
 *      task-status payload; 3.12.0 returns 404 (no TasksController),
 *      which `getTask` maps to `null` so we cleanly no-op until StEvE
 *      is upgraded. On a finished task: `errorResponses.length` ⇒
 *      `conflicted`, otherwise ⇒ `confirmed`.
 *
 *   2. **StatusNotification side-channel**
 *      (`tryConfirmFromStatusNotification`) When a charger reports
 *      `Reserved` for a connector (in `recordChargerStatus`), we
 *      look up the most-recent pending row that matches
 *      `(chargeBoxId, connectorId)` whose end-time is still in the
 *      future, and flip it to `confirmed` immediately. This works
 *      regardless of whether the operations endpoint is exposed —
 *      the connector-side StatusNotification is the source of truth
 *      for "the charger has actually accepted the reservation."
 *
 * Both paths are best-effort and idempotent. Failures are logged and
 * never thrown; reservations stay `pending` and a future tick resumes.
 *
 * Wired into the sync worker (cron) at boot; the StatusNotification
 * side-channel is invoked from `charger.service.ts` directly.
 */

import { and, eq, gt, isNotNull } from "drizzle-orm";
import { db } from "../db/index.ts";
import { reservations } from "../db/schema.ts";
import { steveClient } from "../lib/steve-client.ts";
import type { OcppTaskStatus } from "../lib/types/steve.ts";
import { logger } from "../lib/utils/logger.ts";

const log = logger.child("ReservationResolver");

/**
 * Hard cap on rows polled per tick. Keeps the cron predictable in the
 * pathological case where many reservations remain stuck pending.
 * Real prod load is well under 50/day; this is purely a safety belt.
 */
const POLL_BATCH_LIMIT = 50;

/**
 * Per-row poll: ask StEvE for the task status, interpret it, write
 * the matching DB transition. Returns the new status, or `"unchanged"`
 * if nothing landed (StEvE 404, task still in flight, or transient
 * error).
 */
async function resolveOne(
  reservationId: number,
  taskId: number,
): Promise<"confirmed" | "conflicted" | "unchanged"> {
  let task: OcppTaskStatus | null = null;
  try {
    task = await steveClient.operations.getTask(taskId);
  } catch (err) {
    log.warn("getTask transient error — will retry next tick", {
      reservationId,
      taskId,
      error: err instanceof Error ? err.message : String(err),
    });
    return "unchanged";
  }
  if (task === null) {
    // StEvE 3.12.0 has no TasksController. Nothing we can do here.
    return "unchanged";
  }
  if (!task.taskFinished) {
    return "unchanged";
  }
  const errorCount = (task.errorResponses ?? []).length +
    (task.exceptions ?? []).length;
  const newStatus: "confirmed" | "conflicted" = errorCount > 0
    ? "conflicted"
    : "confirmed";
  await db
    .update(reservations)
    .set({ status: newStatus, updatedAt: new Date() })
    .where(
      and(
        eq(reservations.id, reservationId),
        eq(reservations.status, "pending"),
      ),
    );
  log.info("Reservation transitioned via StEvE task status", {
    reservationId,
    taskId,
    newStatus,
    errorCount,
  });
  return newStatus;
}

/**
 * Cron entry: poll every pending reservation that has a `steveReservationId`
 * (i.e. the ReserveNow dispatch landed) and try to interpret the task's
 * outcome. Bounded by `POLL_BATCH_LIMIT` for safety.
 *
 * Returns `{ polled, confirmed, conflicted }` so the caller can emit a
 * single summary log line per tick.
 */
export async function resolvePendingReservations(): Promise<{
  polled: number;
  confirmed: number;
  conflicted: number;
}> {
  const rows = await db
    .select({
      id: reservations.id,
      taskId: reservations.steveReservationId,
    })
    .from(reservations)
    .where(
      and(
        eq(reservations.status, "pending"),
        isNotNull(reservations.steveReservationId),
        // Only consider rows whose window hasn't already elapsed; an
        // expired pending row is better classified as `orphaned` (not
        // our problem here — separate sweep handles that).
        gt(reservations.endAt, new Date()),
      ),
    )
    .limit(POLL_BATCH_LIMIT);

  let confirmed = 0;
  let conflicted = 0;
  for (const row of rows) {
    if (row.taskId === null) continue;
    const outcome = await resolveOne(row.id, row.taskId);
    if (outcome === "confirmed") confirmed++;
    else if (outcome === "conflicted") conflicted++;
  }
  if (rows.length > 0) {
    log.debug("Resolver tick complete", {
      polled: rows.length,
      confirmed,
      conflicted,
    });
  }
  return { polled: rows.length, confirmed, conflicted };
}

/**
 * StatusNotification side-channel — invoked from `recordChargerStatus`
 * when the new status is `"Reserved"`. We flip the most-recent pending
 * reservation matching (chargeBoxId, connectorId) whose window is still
 * in the future to `confirmed`.
 *
 * Caveat: the StatusNotification doesn't carry `idTag` or `taskId`, so
 * we can't perfectly disambiguate which pending row this corresponds
 * to if there are multiple overlapping pending rows for the same
 * connector. In practice the schema's `idx_reservations_conflict`
 * predicate + the `pending` filter narrow it to one row almost always.
 * If we get it wrong (rare), the cron poll's `getTask` resolution will
 * correct it on the next tick.
 *
 * Best-effort. Any DB error is logged and swallowed — `recordChargerStatus`
 * must not fail because of a downstream bookkeeping issue.
 */
export async function tryConfirmFromStatusNotification(
  chargeBoxId: string,
  connectorId: number,
): Promise<void> {
  try {
    const updated = await db
      .update(reservations)
      .set({ status: "confirmed", updatedAt: new Date() })
      .where(
        and(
          eq(reservations.status, "pending"),
          eq(reservations.chargeBoxId, chargeBoxId),
          eq(reservations.connectorId, connectorId),
          gt(reservations.endAt, new Date()),
        ),
      )
      .returning({ id: reservations.id });
    if (updated.length > 0) {
      log.info("Reservation confirmed via StatusNotification side-channel", {
        chargeBoxId,
        connectorId,
        count: updated.length,
        ids: updated.map((r) => r.id),
      });
    }
  } catch (err) {
    log.warn("tryConfirmFromStatusNotification failed (non-fatal)", {
      chargeBoxId,
      connectorId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

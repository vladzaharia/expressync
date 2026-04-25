/**
 * Reservation Service (Phase P3)
 *
 * Single owner of reservation CRUD + conflict detection. Routes must go
 * through this module so the half-open-interval semantics + optional
 * charging-profile hook stay consistent.
 *
 * Intervals are half-open `[start, end)`: a booking that ENDS at 15:00 does
 * NOT conflict with a booking that STARTS at 15:00. All times are stored /
 * compared in UTC; UI layers translate to charger-local tz at render time.
 *
 * The charging-profile hook (P5) is optional and called via dynamic import
 * + try/catch so this file can ship before `charging-profile.service.ts`
 * exists.
 */

import { and, asc, desc, eq, gte, inArray, lt, ne, or, sql } from "drizzle-orm";
import { db } from "../db/index.ts";
import * as schema from "../db/schema.ts";
import type { Reservation, ReservationStatus } from "../db/schema.ts";
import { logger } from "../lib/utils/logger.ts";
import { steveClient } from "../lib/steve-client.ts";
import { createNotification } from "./notification.service.ts";

export interface ConflictRow {
  id: number;
  startAtIso: string;
  endAtIso: string;
  status: ReservationStatus;
  steveOcppIdTag: string;
}

export interface ConflictCheckInput {
  chargeBoxId: string;
  connectorId: number;
  startAt: Date;
  endAt: Date;
  /** When rescheduling, exclude the row being edited. */
  excludeReservationId?: number;
}

/** Statuses considered "blocking" for the purpose of conflict detection. */
const BLOCKING_STATUSES: ReservationStatus[] = [
  "pending",
  "confirmed",
  "active",
];

/**
 * Find overlaps on the same (chargeBoxId, connectorId) using half-open
 * intervals. `connectorId = 0` is the charger-wide wildcard — a connector-0
 * reservation conflicts with every connector on that chargeBoxId, and any
 * per-connector reservation conflicts with an existing connector-0 booking.
 */
export async function checkConflicts(
  input: ConflictCheckInput,
): Promise<ConflictRow[]> {
  const { chargeBoxId, connectorId, startAt, endAt, excludeReservationId } =
    input;

  if (!(endAt > startAt)) {
    throw new Error("endAt must be strictly greater than startAt");
  }

  const connectorCondition = connectorId === 0
    ? eq(schema.reservations.chargeBoxId, chargeBoxId)
    : and(
      eq(schema.reservations.chargeBoxId, chargeBoxId),
      // Match same connector OR charger-wide (connector 0) booking.
      or(
        eq(schema.reservations.connectorId, connectorId),
        eq(schema.reservations.connectorId, 0),
      ),
    );

  const whereClauses = [
    connectorCondition!,
    inArray(schema.reservations.status, BLOCKING_STATUSES),
    // Half-open overlap: existing.start < new.end AND existing.end > new.start
    lt(schema.reservations.startAt, endAt),
    sql`${schema.reservations.endAt} > ${startAt}`,
  ];

  if (excludeReservationId !== undefined) {
    whereClauses.push(ne(schema.reservations.id, excludeReservationId));
  }

  const rows = await db
    .select({
      id: schema.reservations.id,
      startAt: schema.reservations.startAt,
      endAt: schema.reservations.endAt,
      status: schema.reservations.status,
      steveOcppIdTag: schema.reservations.steveOcppIdTag,
    })
    .from(schema.reservations)
    .where(and(...whereClauses))
    .orderBy(asc(schema.reservations.startAt));

  return rows.map((r) => ({
    id: r.id,
    startAtIso: (r.startAt ?? new Date()).toISOString(),
    endAtIso: (r.endAt ?? new Date()).toISOString(),
    status: r.status as ReservationStatus,
    steveOcppIdTag: r.steveOcppIdTag,
  }));
}

export interface CreateReservationInput {
  chargeBoxId: string;
  connectorId: number;
  steveOcppTagPk: number;
  steveOcppIdTag: string;
  lagoSubscriptionExternalId?: string | null;
  startAt: Date;
  endAt: Date;
  createdByUserId?: string | null;
  /** Skip conflict check (set only by admin override flows). */
  force?: boolean;
}

export interface CreateReservationResult {
  reservation: Reservation;
  conflicts: ConflictRow[];
}

/**
 * Persist a reservation (status='pending') after a conflict check. When a
 * conflict exists and `force` is false, the row is NOT written; caller gets
 * `conflicts` back for the UI. The optional charging-profile hook runs
 * non-blocking after a successful insert.
 */
export async function createReservation(
  input: CreateReservationInput,
): Promise<CreateReservationResult> {
  if (!(input.endAt > input.startAt)) {
    throw new Error("endAt must be strictly greater than startAt");
  }

  const conflicts = input.force ? [] : await checkConflicts({
    chargeBoxId: input.chargeBoxId,
    connectorId: input.connectorId,
    startAt: input.startAt,
    endAt: input.endAt,
  });

  if (conflicts.length > 0) {
    return {
      reservation: null as unknown as Reservation,
      conflicts,
    };
  }

  const durationMinutes = Math.max(
    1,
    Math.round((input.endAt.getTime() - input.startAt.getTime()) / 60_000),
  );

  const [inserted] = await db
    .insert(schema.reservations)
    .values({
      chargeBoxId: input.chargeBoxId,
      connectorId: input.connectorId,
      steveOcppTagPk: input.steveOcppTagPk,
      steveOcppIdTag: input.steveOcppIdTag,
      lagoSubscriptionExternalId: input.lagoSubscriptionExternalId ?? null,
      startAt: input.startAt,
      endAt: input.endAt,
      durationMinutes,
      status: "pending",
      createdByUserId: input.createdByUserId ?? null,
    })
    .returning();

  // Optional charging-profile hook. Dynamic import so this file compiles and
  // ships whether or not agent-profile (P5) has merged. Failure is non-fatal.
  let profileTaskId: number | null = null;
  try {
    // Relative specifier — resolves via Deno filesystem at import time.
    const mod = await import("./charging-profile.service.ts");
    const hook = (mod as {
      onReservationCreated?: (args: {
        reservationId: number;
        chargeBoxId: string;
        connectorId: number;
        lagoSubscriptionExternalId: string | null;
        startAt: Date;
        endAt: Date;
      }) => Promise<{ taskId?: number | null } | null | undefined>;
    }).onReservationCreated;
    if (typeof hook === "function") {
      const result = await hook({
        reservationId: inserted.id,
        chargeBoxId: inserted.chargeBoxId,
        connectorId: inserted.connectorId,
        lagoSubscriptionExternalId: inserted.lagoSubscriptionExternalId,
        startAt: inserted.startAt ?? input.startAt,
        endAt: inserted.endAt ?? input.endAt,
      });
      if (result && typeof result.taskId === "number") {
        profileTaskId = result.taskId;
      }
    }
  } catch (err) {
    // P5 not merged, or the hook failed. We only log at debug level because
    // the absence of the module is expected in early-P3 deployments.
    logger.debug("Reservations", "Charging-profile hook skipped", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  let reservation = inserted;
  if (profileTaskId !== null) {
    const [updated] = await db
      .update(schema.reservations)
      .set({ chargingProfileTaskId: profileTaskId, updatedAt: new Date() })
      .where(eq(schema.reservations.id, inserted.id))
      .returning();
    reservation = updated ?? inserted;
  }

  // Dispatch ReserveNow to StEvE. Non-blocking — a StEvE outage must not
  // break local reservation creation, so we log+swallow failures and leave
  // `steve_reservation_id = null`. The row stays at `status='pending'`;
  // transition to `confirmed` is the responsibility of a future task-
  // resolver that polls `steveClient.operations.getTask(taskId)` and
  // interprets the async ReserveNow response. TODO: build that resolver
  // (likely a cron + webhook-on-StatusNotification combo).
  try {
    const taskResult = await steveClient.operations.reserveNow({
      chargeBoxId: reservation.chargeBoxId,
      connectorId: reservation.connectorId,
      expiry: (reservation.endAt ?? input.endAt).toISOString(),
      idTag: reservation.steveOcppIdTag,
    });
    if (taskResult && typeof taskResult.taskId === "number") {
      const [updated] = await db
        .update(schema.reservations)
        .set({
          steveReservationId: taskResult.taskId,
          updatedAt: new Date(),
        })
        .where(eq(schema.reservations.id, reservation.id))
        .returning();
      reservation = updated ?? reservation;
    }
  } catch (err) {
    logger.warn("Reservations", "StEvE ReserveNow dispatch failed", {
      reservationId: reservation.id,
      chargeBoxId: reservation.chargeBoxId,
      connectorId: reservation.connectorId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { reservation, conflicts: [] };
}

/**
 * Cancel a reservation. Idempotent: cancelling an already-cancelled row is
 * a no-op that returns the existing row.
 *
 * Polaris Track H: when an active reservation is cancelled (by admin or by
 * a Lago subscription teardown), this fires a `reservation.cancelled`
 * customer notification — which in turn triggers the customer email via
 * `notification.service.ts`'s post-create hook. The optional `reason`
 * threads through to both the in-app body copy and the email highlight.
 */
export async function cancelReservation(
  reservationId: number,
  reason?: string,
): Promise<Reservation | null> {
  const [existing] = await db
    .select()
    .from(schema.reservations)
    .where(eq(schema.reservations.id, reservationId))
    .limit(1);

  if (!existing) return null;
  if (existing.status === "cancelled") return existing;

  // Best-effort StEvE CancelReservation dispatch BEFORE we flip the row so
  // the StEvE side gets a chance to tear down the reservation even if our
  // status update races with a concurrent cancellation. Non-blocking: a
  // StEvE outage must not prevent local cancellation.
  if (
    existing.steveReservationId !== null &&
    (existing.status === "pending" || existing.status === "confirmed")
  ) {
    try {
      await steveClient.operations.cancelReservation({
        chargeBoxId: existing.chargeBoxId,
        reservationId: existing.steveReservationId,
      });
    } catch (err) {
      logger.warn("Reservations", "StEvE CancelReservation dispatch failed", {
        reservationId: existing.id,
        steveReservationId: existing.steveReservationId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const [updated] = await db
    .update(schema.reservations)
    .set({
      status: "cancelled",
      cancelledAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.reservations.id, reservationId))
    .returning();

  // Polaris Track H — fire customer notification + email. Non-blocking:
  // any failure here is logged inside `notifyReservationCancelled` so the
  // cancellation itself isn't reverted by a notification-store outage.
  await notifyReservationCancelled(updated ?? existing, reason);

  return updated ?? existing;
}

/**
 * Polaris Track H — emit a `reservation.cancelled` customer notification
 * for the supplied reservation. Looks up the owning user via the tag
 * mapping; no-ops cleanly when the mapping is missing (e.g. a deleted
 * customer account, or a system-created reservation without a user link).
 *
 * The notification.service.ts post-create hook fires the customer email
 * automatically when the audience is `customer` and the kind matches.
 *
 * Errors are caught and logged so a notification-store outage does not
 * destabilise the cancel flow itself.
 */
async function notifyReservationCancelled(
  reservation: Reservation,
  reason: string | undefined,
): Promise<void> {
  try {
    // Resolve owning customer user_id via the tag mapping. We accept any
    // mapping (active or inactive) since a reservation owned by a since-
    // unlinked tag should still notify the original customer.
    const [mapping] = await db
      .select({ userId: schema.userMappings.userId })
      .from(schema.userMappings)
      .where(eq(schema.userMappings.steveOcppTagPk, reservation.steveOcppTagPk))
      .limit(1);

    const userId = mapping?.userId;
    if (!userId) {
      // No customer user — likely a legacy mapping pre-Polaris or a
      // backfill row that hasn't been linked yet. Skip silently; admin
      // tooling can resurface the cancel via the audit log.
      return;
    }

    // Best-effort charger label. Falls back to chargeBoxId when the
    // friendly name isn't cached (admin hasn't populated chargers_cache
    // yet, or the cache row was evicted).
    const [charger] = await db
      .select({ friendlyName: schema.chargersCache.friendlyName })
      .from(schema.chargersCache)
      .where(eq(schema.chargersCache.chargeBoxId, reservation.chargeBoxId))
      .limit(1);
    const chargerName = charger?.friendlyName ?? reservation.chargeBoxId;

    const startAt = reservation.startAt ?? new Date();
    const endAt = reservation.endAt ?? new Date();

    // Format date / time for both the in-app body and the email metadata.
    // Format-locale is intentionally `en-US` to match the email templates'
    // expectations; UI consumers re-format from the underlying ISO
    // timestamps when they need a localized view.
    const dateStr = startAt.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    const timeStr = `${
      startAt.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    } – ${
      endAt.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    }`;

    await createNotification({
      kind: "reservation.cancelled",
      severity: "info",
      title: "Reservation cancelled",
      body: reason
        ? `Your reservation at ${chargerName} on ${dateStr} was cancelled. Reason: ${reason}`
        : `Your reservation at ${chargerName} on ${dateStr} was cancelled.`,
      sourceType: "reservation",
      sourceId: String(reservation.id),
      audience: "customer",
      userId,
      context: {
        chargeBoxId: reservation.chargeBoxId,
        reservationId: reservation.id,
        startAtIso: startAt.toISOString(),
        endAtIso: endAt.toISOString(),
        reason: reason ?? null,
      },
      emailPayload: {
        kind: "reservation.cancelled",
        reservation: {
          chargerName,
          date: dateStr,
          time: timeStr,
        },
        reason,
      },
    });
  } catch (err) {
    logger.warn("Reservations", "notifyReservationCancelled failed", {
      reservationId: reservation.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export interface RescheduleInput {
  reservationId: number;
  startAt: Date;
  endAt: Date;
  force?: boolean;
}

export interface RescheduleResult {
  reservation: Reservation | null;
  conflicts: ConflictRow[];
}

/**
 * Shift an existing reservation's time window in place. Runs a conflict
 * check that excludes the row being edited.
 */
export async function rescheduleReservation(
  input: RescheduleInput,
): Promise<RescheduleResult> {
  if (!(input.endAt > input.startAt)) {
    throw new Error("endAt must be strictly greater than startAt");
  }

  const [existing] = await db
    .select()
    .from(schema.reservations)
    .where(eq(schema.reservations.id, input.reservationId))
    .limit(1);

  if (!existing) return { reservation: null, conflicts: [] };

  const conflicts = input.force ? [] : await checkConflicts({
    chargeBoxId: existing.chargeBoxId,
    connectorId: existing.connectorId,
    startAt: input.startAt,
    endAt: input.endAt,
    excludeReservationId: input.reservationId,
  });

  if (conflicts.length > 0) {
    return { reservation: null, conflicts };
  }

  const durationMinutes = Math.max(
    1,
    Math.round((input.endAt.getTime() - input.startAt.getTime()) / 60_000),
  );

  const [updated] = await db
    .update(schema.reservations)
    .set({
      startAt: input.startAt,
      endAt: input.endAt,
      durationMinutes,
      updatedAt: new Date(),
    })
    .where(eq(schema.reservations.id, input.reservationId))
    .returning();

  return { reservation: updated ?? null, conflicts: [] };
}

export interface ListOptions {
  limit?: number;
  statuses?: ReservationStatus[];
  /** When true, only rows with `end_at > now()`. */
  upcomingOnly?: boolean;
}

function applyListDefaults(opts: ListOptions): {
  limit: number;
  statuses: ReservationStatus[] | null;
  upcomingOnly: boolean;
} {
  return {
    limit: Math.max(1, Math.min(opts.limit ?? 50, 500)),
    statuses: opts.statuses && opts.statuses.length > 0 ? opts.statuses : null,
    upcomingOnly: opts.upcomingOnly ?? false,
  };
}

export async function listUpcomingByCharger(
  chargeBoxId: string,
  opts: ListOptions = {},
): Promise<Reservation[]> {
  const { limit, statuses, upcomingOnly } = applyListDefaults(opts);
  const clauses = [eq(schema.reservations.chargeBoxId, chargeBoxId)];
  if (statuses) {
    clauses.push(inArray(schema.reservations.status, statuses));
  }
  if (upcomingOnly) {
    clauses.push(gte(schema.reservations.endAt, new Date()));
  }
  return await db
    .select()
    .from(schema.reservations)
    .where(and(...clauses))
    .orderBy(asc(schema.reservations.startAt))
    .limit(limit);
}

export async function listByTag(
  ocppTagPk: number,
  opts: ListOptions = {},
): Promise<Reservation[]> {
  const { limit, statuses, upcomingOnly } = applyListDefaults(opts);
  const clauses = [eq(schema.reservations.steveOcppTagPk, ocppTagPk)];
  if (statuses) {
    clauses.push(inArray(schema.reservations.status, statuses));
  }
  if (upcomingOnly) {
    clauses.push(gte(schema.reservations.endAt, new Date()));
  }
  return await db
    .select()
    .from(schema.reservations)
    .where(and(...clauses))
    .orderBy(desc(schema.reservations.startAt))
    .limit(limit);
}

export async function listBySubscription(
  lagoSubscriptionExternalId: string,
  opts: ListOptions = {},
): Promise<Reservation[]> {
  const { limit, statuses, upcomingOnly } = applyListDefaults(opts);
  const clauses = [
    eq(
      schema.reservations.lagoSubscriptionExternalId,
      lagoSubscriptionExternalId,
    ),
  ];
  if (statuses) {
    clauses.push(inArray(schema.reservations.status, statuses));
  }
  if (upcomingOnly) {
    clauses.push(gte(schema.reservations.endAt, new Date()));
  }
  return await db
    .select()
    .from(schema.reservations)
    .where(and(...clauses))
    .orderBy(desc(schema.reservations.startAt))
    .limit(limit);
}

// ============================================================================
// === Polaris Track F: customer suggestion windows on conflict ==============
// ============================================================================

/** A non-conflicting time window suggested to the customer after a 409. */
export interface ReservationSuggestion {
  startAtIso: string;
  endAtIso: string;
}

export interface SuggestionInput {
  chargeBoxId: string;
  connectorId: number;
  /** Original requested start (used to seed the search). */
  requestedStartAt: Date;
  /** Original requested end. */
  requestedEndAt: Date;
  /** Conflict rows from `checkConflicts` (or `createReservation`). */
  conflicts: ConflictRow[];
}

/**
 * Compute up to 2 nearby non-conflicting windows of the same duration as the
 * customer's original ask, starting after each conflict's end. Only returns
 * windows whose start lies within 24h of the original request.
 *
 * The customer wizard renders these as one-tap chips ("Reserve at 16:30
 * instead?"). When no windows fit within 24h we return an empty array — the
 * UI then falls back to manual reschedule.
 *
 * Performance: at most 2 follow-up `checkConflicts` calls (one per candidate).
 * Cheaper than a full calendar walk.
 */
export async function suggestAlternatives(
  input: SuggestionInput,
): Promise<ReservationSuggestion[]> {
  const durationMs = input.requestedEndAt.getTime() -
    input.requestedStartAt.getTime();
  if (durationMs <= 0) return [];

  // Build candidate starts from each conflict's end-time.
  const conflictEnds = input.conflicts
    .map((c) => new Date(c.endAtIso))
    .filter((d) => !Number.isNaN(d.getTime()))
    // Ascending — we'll try the earliest free slot first.
    .sort((a, b) => a.getTime() - b.getTime());

  if (conflictEnds.length === 0) return [];

  const cutoff = new Date(
    input.requestedStartAt.getTime() + 24 * 60 * 60 * 1000,
  );
  const suggestions: ReservationSuggestion[] = [];

  for (const candidateStart of conflictEnds) {
    if (suggestions.length >= 2) break;
    if (candidateStart > cutoff) break;
    const candidateEnd = new Date(candidateStart.getTime() + durationMs);
    const conflicts = await checkConflicts({
      chargeBoxId: input.chargeBoxId,
      connectorId: input.connectorId,
      startAt: candidateStart,
      endAt: candidateEnd,
    });
    if (conflicts.length === 0) {
      suggestions.push({
        startAtIso: candidateStart.toISOString(),
        endAtIso: candidateEnd.toISOString(),
      });
    }
    // If the candidate also conflicts, advance to its conflict-end to avoid
    // an infinite walk on long, dense calendars.
  }

  return suggestions;
}

/**
 * Bulk-cancel all future reservations owned by the given user. Used by the
 * unlink path (`DELETE /api/admin/tag/link`) when soft-deactivating a tag
 * leaves the customer with zero active mappings — they can no longer charge,
 * so any reservation they hold for a future window is meaningless.
 *
 * Idempotent: cancelled rows are skipped on the next call.
 *
 * Cancellation criteria (all must hold):
 *   - reservation belongs to a user_mapping owned by `userId`
 *     (joined via reservations.steve_ocpp_tag_pk → user_mappings.steve_ocpp_tag_pk)
 *   - end_at is in the future
 *   - status is one of pending/confirmed/active (i.e. not already terminal)
 *
 * Returns the number of rows that transitioned to `cancelled`. Best-effort
 * StEvE CancelReservation is intentionally NOT dispatched here: when the
 * user's tag is being deactivated, the StEvE-side reservations are also
 * losing their authorising tag — the next sync pass + the StEvE-side state
 * machine will tear them down naturally.
 */
export async function bulkCancelFutureReservationsForUser(
  userId: string,
): Promise<number> {
  if (!userId) return 0;

  // Fetch all OCPP tag PKs the user owns. We can't filter by `is_active`
  // here because the unlink workflow flips `is_active=false` for the user's
  // mappings BEFORE calling this function — so we want to cancel whatever
  // reservations were attached to ANY of their mapped tags.
  const mappingRows = await db
    .select({ steveOcppTagPk: schema.userMappings.steveOcppTagPk })
    .from(schema.userMappings)
    .where(eq(schema.userMappings.userId, userId));

  if (mappingRows.length === 0) return 0;
  const tagPks = mappingRows.map((r) => r.steveOcppTagPk);

  const updated = await db
    .update(schema.reservations)
    .set({
      status: "cancelled",
      cancelledAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        inArray(schema.reservations.steveOcppTagPk, tagPks),
        gte(schema.reservations.endAt, new Date()),
        inArray(
          schema.reservations.status,
          ["pending", "confirmed", "active"] as ReservationStatus[],
        ),
      ),
    )
    .returning({ id: schema.reservations.id });

  if (updated.length > 0) {
    logger.info(
      "Reservations",
      "Bulk-cancelled future reservations on unlink",
      {
        userId,
        count: updated.length,
        reservationIds: updated.map((r) => r.id),
      },
    );
  }
  return updated.length;
}

/** Convert a DB row into the cross-domain DTO sibling surfaces consume. */
export function toReservationRowDTO(
  r: Reservation,
): schema.ReservationRowDTO {
  return {
    id: r.id,
    chargeBoxId: r.chargeBoxId,
    connectorId: r.connectorId,
    ocppTagPk: r.steveOcppTagPk,
    ocppTagId: r.steveOcppIdTag,
    startAtIso: (r.startAt ?? new Date()).toISOString(),
    endAtIso: (r.endAt ?? new Date()).toISOString(),
    status: r.status as ReservationStatus,
    lagoSubscriptionExternalId: r.lagoSubscriptionExternalId,
    chargingProfileTaskId: r.chargingProfileTaskId,
  };
}

/**
 * Best-effort: hydrate the friendly_name field on a batch of DTOs from the
 * `chargers_cache` table so UI surfaces can show the operator-set description
 * as the primary label. A cache miss leaves friendlyName at null — callers
 * MUST fall back to chargeBoxId in that case.
 */
export async function enrichDtosWithFriendlyNames(
  rows: schema.ReservationRowDTO[],
): Promise<schema.ReservationRowDTO[]> {
  if (rows.length === 0) return rows;
  const cbids = Array.from(new Set(rows.map((r) => r.chargeBoxId)));
  try {
    const cacheRows = await db
      .select({
        chargeBoxId: schema.chargersCache.chargeBoxId,
        friendlyName: schema.chargersCache.friendlyName,
      })
      .from(schema.chargersCache)
      .where(inArray(schema.chargersCache.chargeBoxId, cbids));
    const byCbid = new Map<string, string | null>();
    for (const c of cacheRows) byCbid.set(c.chargeBoxId, c.friendlyName);
    return rows.map((r) => ({
      ...r,
      friendlyName: byCbid.get(r.chargeBoxId) ?? null,
    }));
  } catch (err) {
    logger.warn(
      "ReservationService",
      "friendly-name enrichment failed; falling back to chargeBoxId",
      { error: err instanceof Error ? err.message : String(err) },
    );
    return rows;
  }
}

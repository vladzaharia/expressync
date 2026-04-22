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
 */
export async function cancelReservation(
  reservationId: number,
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

  return updated ?? existing;
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

/**
 * Customer single-reservation operations.
 *
 *   GET    — fetch one row owned by caller
 *   PATCH  — reschedule (capability `reserve` + ownership)
 *   DELETE — cancel (capability `reserve` + ownership)
 *
 * All handlers run `assertOwnership("reservation", id)` first; non-owners get
 * a 404 (anti-enumeration). Mutations also require `reserve` capability,
 * which is denied for accounts with no active mappings.
 */

import { define } from "../../../../utils.ts";
import { eq } from "drizzle-orm";
import { db } from "../../../../src/db/index.ts";
import * as schema from "../../../../src/db/schema.ts";
import {
  cancelReservation,
  rescheduleReservation,
  suggestAlternatives,
  toReservationRowDTO,
} from "../../../../src/services/reservation.service.ts";
import {
  assertOwnership,
  OwnershipError,
} from "../../../../src/lib/scoping.ts";
import {
  assertCapability,
  CapabilityDeniedError,
} from "../../../../src/lib/capabilities.ts";
import { logCustomerAction } from "../../../../src/lib/audit.ts";
import { logger } from "../../../../src/lib/utils/logger.ts";

const log = logger.child("CustomerReservationDetailAPI");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function parseId(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export const handler = define.handlers({
  async GET(ctx) {
    if (!ctx.state.user) {
      return jsonResponse(401, { error: "Unauthorized" });
    }
    const id = parseId(ctx.params.id);
    if (id === null) return jsonResponse(400, { error: "Invalid id" });

    try {
      await assertOwnership(ctx, "reservation", id);
      const [row] = await db
        .select()
        .from(schema.reservations)
        .where(eq(schema.reservations.id, id))
        .limit(1);
      if (!row) return jsonResponse(404, { error: "Reservation not found" });
      return jsonResponse(200, { reservation: toReservationRowDTO(row) });
    } catch (err) {
      if (err instanceof OwnershipError) {
        return jsonResponse(404, { error: "Reservation not found" });
      }
      log.error("Failed to fetch reservation", err as Error);
      return jsonResponse(500, { error: "Failed to fetch reservation" });
    }
  },

  async PATCH(ctx) {
    if (!ctx.state.user) {
      return jsonResponse(401, { error: "Unauthorized" });
    }
    if (ctx.state.actingAs) {
      return jsonResponse(403, {
        error: "Read-only while impersonating; use admin tools to mutate.",
      });
    }
    const id = parseId(ctx.params.id);
    if (id === null) return jsonResponse(400, { error: "Invalid id" });

    let body: { startAtIso?: unknown; endAtIso?: unknown };
    try {
      body = await ctx.req.json();
    } catch {
      return jsonResponse(400, { error: "Invalid JSON body" });
    }
    const { startAtIso, endAtIso } = body;
    if (typeof startAtIso !== "string" || typeof endAtIso !== "string") {
      return jsonResponse(400, {
        error: "startAtIso and endAtIso must be ISO strings",
      });
    }
    const startAt = new Date(startAtIso);
    const endAt = new Date(endAtIso);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
      return jsonResponse(400, { error: "Invalid ISO timestamp" });
    }
    if (!(endAt > startAt)) {
      return jsonResponse(400, { error: "endAt must be after startAt" });
    }

    try {
      await assertCapability(ctx, "reserve");
      await assertOwnership(ctx, "reservation", id);

      const result = await rescheduleReservation({
        reservationId: id,
        startAt,
        endAt,
        force: false,
      });

      if (!result.reservation && result.conflicts.length === 0) {
        return jsonResponse(404, { error: "Reservation not found" });
      }
      if (result.conflicts.length > 0) {
        // Look up the existing row to suggest alternatives on its
        // (chargeBoxId, connectorId).
        const [existing] = await db
          .select({
            chargeBoxId: schema.reservations.chargeBoxId,
            connectorId: schema.reservations.connectorId,
          })
          .from(schema.reservations)
          .where(eq(schema.reservations.id, id))
          .limit(1);
        const suggestions = existing
          ? await suggestAlternatives({
            chargeBoxId: existing.chargeBoxId,
            connectorId: existing.connectorId,
            requestedStartAt: startAt,
            requestedEndAt: endAt,
            conflicts: result.conflicts,
          })
          : [];
        return jsonResponse(409, {
          error: "Time window conflicts with existing reservation(s)",
          conflicts: result.conflicts,
          suggestions,
        });
      }

      await logCustomerAction({
        userId: ctx.state.user.id,
        action: "reservation-reschedule",
        route: new URL(ctx.req.url).pathname,
        metadata: { reservationId: id },
      });

      return jsonResponse(200, {
        reservation: toReservationRowDTO(result.reservation!),
      });
    } catch (err) {
      if (err instanceof CapabilityDeniedError) {
        return jsonResponse(403, {
          error: "Account inactive",
          capability: err.capability,
        });
      }
      if (err instanceof OwnershipError) {
        return jsonResponse(404, { error: "Reservation not found" });
      }
      log.error("Failed to reschedule reservation", err as Error);
      return jsonResponse(500, { error: "Failed to reschedule reservation" });
    }
  },

  async DELETE(ctx) {
    if (!ctx.state.user) {
      return jsonResponse(401, { error: "Unauthorized" });
    }
    if (ctx.state.actingAs) {
      return jsonResponse(403, {
        error: "Read-only while impersonating; use admin tools to mutate.",
      });
    }
    const id = parseId(ctx.params.id);
    if (id === null) return jsonResponse(400, { error: "Invalid id" });

    try {
      await assertCapability(ctx, "reserve");
      await assertOwnership(ctx, "reservation", id);

      const row = await cancelReservation(id);
      if (!row) return jsonResponse(404, { error: "Reservation not found" });

      await logCustomerAction({
        userId: ctx.state.user.id,
        action: "reservation-cancel",
        route: new URL(ctx.req.url).pathname,
        metadata: { reservationId: id },
      });

      return jsonResponse(200, { reservation: toReservationRowDTO(row) });
    } catch (err) {
      if (err instanceof CapabilityDeniedError) {
        return jsonResponse(403, {
          error: "Account inactive",
          capability: err.capability,
        });
      }
      if (err instanceof OwnershipError) {
        return jsonResponse(404, { error: "Reservation not found" });
      }
      log.error("Failed to cancel reservation", err as Error);
      return jsonResponse(500, { error: "Failed to cancel reservation" });
    }
  },
});

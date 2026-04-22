/**
 * Reservations API — single-row operations.
 *
 * GET    /api/reservations/[id]   — fetch one row
 * DELETE /api/reservations/[id]   — cancel (soft)
 * PATCH  /api/reservations/[id]   — reschedule; body { startAtIso, endAtIso }
 */

import { define } from "../../../utils.ts";
import { eq } from "drizzle-orm";
import { db } from "../../../src/db/index.ts";
import * as schema from "../../../src/db/schema.ts";
import {
  cancelReservation,
  rescheduleReservation,
  toReservationRowDTO,
} from "../../../src/services/reservation.service.ts";
import { logger } from "../../../src/lib/utils/logger.ts";

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
    const id = parseId(ctx.params.id);
    if (id === null) return jsonResponse(400, { error: "Invalid id" });

    try {
      const [row] = await db
        .select()
        .from(schema.reservations)
        .where(eq(schema.reservations.id, id))
        .limit(1);
      if (!row) return jsonResponse(404, { error: "Reservation not found" });
      return jsonResponse(200, { reservation: toReservationRowDTO(row) });
    } catch (error) {
      logger.error(
        "ReservationsAPI",
        "Failed to fetch reservation",
        error as Error,
      );
      return jsonResponse(500, { error: "Failed to fetch reservation" });
    }
  },

  async DELETE(ctx) {
    const id = parseId(ctx.params.id);
    if (id === null) return jsonResponse(400, { error: "Invalid id" });

    try {
      const row = await cancelReservation(id);
      if (!row) return jsonResponse(404, { error: "Reservation not found" });
      return jsonResponse(200, { reservation: toReservationRowDTO(row) });
    } catch (error) {
      logger.error(
        "ReservationsAPI",
        "Failed to cancel reservation",
        error as Error,
      );
      return jsonResponse(500, { error: "Failed to cancel reservation" });
    }
  },

  async PATCH(ctx) {
    const id = parseId(ctx.params.id);
    if (id === null) return jsonResponse(400, { error: "Invalid id" });

    let body: { startAtIso?: unknown; endAtIso?: unknown; force?: unknown };
    try {
      body = await ctx.req.json();
    } catch {
      return jsonResponse(400, { error: "Invalid JSON body" });
    }

    const { startAtIso, endAtIso, force } = body;
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
      const result = await rescheduleReservation({
        reservationId: id,
        startAt,
        endAt,
        force: force === true,
      });

      if (!result.reservation && result.conflicts.length === 0) {
        return jsonResponse(404, { error: "Reservation not found" });
      }
      if (result.conflicts.length > 0) {
        return jsonResponse(409, {
          error: "Time window conflicts with existing reservation(s)",
          conflicts: result.conflicts,
        });
      }

      return jsonResponse(200, {
        reservation: toReservationRowDTO(result.reservation!),
      });
    } catch (error) {
      logger.error(
        "ReservationsAPI",
        "Failed to reschedule reservation",
        error as Error,
      );
      return jsonResponse(500, { error: "Failed to reschedule reservation" });
    }
  },
});

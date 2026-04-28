/**
 * ExpresScan v2 / Wave 6 Slice J — admin charger cancel-reservation.
 *
 * DELETE /api/admin/devices/{deviceId}/cancel-reservation
 *   (POST also accepted for HTTP-method-shy clients — same semantics)
 *
 * Bearer-auth'd device-API endpoint. Cancels an upcoming reservation on
 * the charger by reservation id. Friends-and-family scope: any device
 * with `user` may cancel any reservation; per-row owner gating is a
 * future PR (see `60-security.md` addendum / threat model T5).
 *
 * Body (strict):
 *   { reservationId: string }   // numeric id rendered as a string by iOS
 *
 * Pre-flight rejections:
 *   401 unauthorized              — no bearer
 *   403 capability_denied         — caller lacks `user`
 *   400 invalid_body              — body fails the strict schema
 *   404 charger_not_found         — charger unknown
 *   404 reservation_not_found     — reservation id doesn't match the charger
 *   409 charger_offline           — `lastStatusAt` outside the 90 s window
 *   409 already_cancelled         — reservation already in `cancelled` state
 *
 * Idempotency: wraps in `withIdempotency`.
 * Audit: `device.user.cancel_reservation`.
 */

import { eq } from "drizzle-orm";
import { z } from "zod";
import { define } from "../../../../../utils.ts";
import { db } from "../../../../../src/db/index.ts";
import { reservations as reservationsTable } from "../../../../../src/db/schema.ts";
import { cancelReservation } from "../../../../../src/services/reservation.service.ts";
import {
  CapabilityDeniedError,
  requireCapability,
} from "../../../../../src/lib/devices/capability-gate.ts";
import {
  ChargerNotFoundError,
  ChargerOfflineError,
  requireOnlineCharger,
} from "../../../../../src/lib/chargers/online.ts";
import { withIdempotency } from "../../../../../src/lib/idempotency.ts";
import { logDeviceUserCancelReservation } from "../../../../../src/lib/audit.ts";
import { logger } from "../../../../../src/lib/utils/logger.ts";

const log = logger.child("AdminDeviceCancelReservation");

const ROUTE = "/api/admin/devices/[deviceId]/cancel-reservation";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const CancelBodySchema = z.object({
  // iOS sends string IDs across the wire; coerce to int after parsing.
  reservationId: z.string().min(1),
}).strict();

export type CancelBody = z.infer<typeof CancelBodySchema>;

// ---------------------------------------------------------------------------
// Test seams
// ---------------------------------------------------------------------------

interface ReservationLookupRow {
  id: number;
  chargeBoxId: string;
  status: string;
}

type ReservationLookup = (
  reservationId: number,
) => Promise<ReservationLookupRow | null>;
type ReservationCanceller = (
  reservationId: number,
) => Promise<{ id: number; status: string } | null>;

const defaultReservationLookup: ReservationLookup = async (reservationId) => {
  const [row] = await db
    .select({
      id: reservationsTable.id,
      chargeBoxId: reservationsTable.chargeBoxId,
      status: reservationsTable.status,
    })
    .from(reservationsTable)
    .where(eq(reservationsTable.id, reservationId))
    .limit(1);
  return row ?? null;
};

const defaultReservationCanceller: ReservationCanceller = async (
  reservationId,
) => {
  const row = await cancelReservation(reservationId);
  return row ? { id: row.id, status: row.status } : null;
};

let reservationLookup: ReservationLookup = defaultReservationLookup;
let reservationCanceller: ReservationCanceller = defaultReservationCanceller;

export function _setReservationLookupForTests(
  fn: ReservationLookup | null,
): void {
  reservationLookup = fn ?? defaultReservationLookup;
}
export function _setReservationCancellerForTests(
  fn: ReservationCanceller | null,
): void {
  reservationCanceller = fn ?? defaultReservationCanceller;
}
export function _resetCancelReservationTestSeams(): void {
  reservationLookup = defaultReservationLookup;
  reservationCanceller = defaultReservationCanceller;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

interface CancelCtx {
  req: Request;
  // deno-lint-ignore no-explicit-any
  state: any;
  params: Record<string, string>;
}

async function runHandler(ctx: CancelCtx): Promise<Response> {
  if (!ctx.state.device) {
    return jsonResponse(401, { error: "unauthorized" });
  }
  try {
    await requireCapability(ctx, "user");
  } catch (err) {
    if (err instanceof CapabilityDeniedError) {
      return jsonResponse(403, {
        error: "capability_denied",
        missing: err.missing,
      });
    }
    throw err;
  }

  const chargerId = ctx.params.deviceId;
  if (!chargerId || chargerId.length === 0) {
    return jsonResponse(404, { error: "charger_not_found" });
  }

  // ---- body ----
  let body: CancelBody;
  try {
    const text = await ctx.req.text();
    if (text.trim() === "") return jsonResponse(400, { error: "invalid_body" });
    const parsed = CancelBodySchema.safeParse(JSON.parse(text));
    if (!parsed.success) {
      return jsonResponse(400, {
        error: "invalid_body",
        details: parsed.error.issues,
      });
    }
    body = parsed.data;
  } catch {
    return jsonResponse(400, { error: "invalid_body" });
  }

  const reservationIdNum = Number.parseInt(body.reservationId, 10);
  if (!Number.isInteger(reservationIdNum) || reservationIdNum <= 0) {
    return jsonResponse(400, { error: "invalid_body" });
  }

  // ---- charger online preflight ----
  try {
    await requireOnlineCharger(chargerId);
  } catch (err) {
    if (err instanceof ChargerNotFoundError) {
      return jsonResponse(404, { error: "charger_not_found" });
    }
    if (err instanceof ChargerOfflineError) {
      return jsonResponse(409, {
        error: "charger_offline",
        lastSeenAt: err.lastSeenAt ? err.lastSeenAt.toISOString() : null,
      });
    }
    log.error("Charger preflight failed", {
      chargerId,
      error: err instanceof Error ? err.message : String(err),
    });
    return jsonResponse(500, { error: "internal_error" });
  }

  // ---- reservation lookup ----
  const existing = await reservationLookup(reservationIdNum);
  if (!existing) {
    return jsonResponse(404, { error: "reservation_not_found" });
  }
  if (existing.chargeBoxId !== chargerId) {
    // Reservation exists but belongs to a different charger — anti-
    // enumeration: 404 (not 403). Don't leak that the id is real.
    return jsonResponse(404, { error: "reservation_not_found" });
  }
  if (existing.status === "cancelled") {
    return jsonResponse(409, {
      error: "already_cancelled",
      reservationId: existing.id,
    });
  }

  // ---- cancel ----
  const result = await reservationCanceller(reservationIdNum);
  if (!result) {
    return jsonResponse(404, { error: "reservation_not_found" });
  }

  const callerDeviceId = ctx.state.device.id;
  const callerOwnerUserId = ctx.state.device.ownerUserId;
  void logDeviceUserCancelReservation({
    userId: callerOwnerUserId,
    route: ROUTE,
    metadata: {
      deviceId: callerDeviceId,
      chargerId,
      reservationId: result.id,
    },
  });

  return jsonResponse(200, {
    reservationId: result.id,
    status: result.status,
  });
}

export const handler = define.handlers({
  DELETE(ctx) {
    return withIdempotency(ctx, ROUTE, () => runHandler(ctx));
  },
  POST(ctx) {
    return withIdempotency(ctx, ROUTE, () => runHandler(ctx));
  },
});

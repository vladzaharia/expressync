/**
 * ExpresScan v2 / Wave 6 Slice J — admin charger reservations list.
 *
 * GET /api/admin/devices/{deviceId}/reservations
 *
 * Bearer-auth'd device-API endpoint. Returns the next 20 upcoming
 * reservations on the charger (including admin-set blackout periods).
 * The iOS Reservations card renders this list with a [Cancel] button
 * per row; under the friends-and-family scope every row is cancellable
 * by anyone with the `user` capability so `isCancelable` is always true
 * here. The field exists so the customer-token rollout (a future PR)
 * can flip it per row without an iOS-side schema change.
 *
 * Response shape:
 *   ReservationRow[]
 *
 *   type ReservationRow = {
 *     reservationId: string;
 *     startsAt: string;
 *     endsAt: string;
 *     customerLabel: string | null;
 *     isBlackout: boolean;
 *     idTag: string | null;
 *     isCancelable: boolean;
 *   };
 */

import { inArray } from "drizzle-orm";
import { define } from "../../../../../utils.ts";
import { db } from "../../../../../src/db/index.ts";
import { userMappings } from "../../../../../src/db/schema.ts";
import { listUpcomingByCharger } from "../../../../../src/services/reservation.service.ts";
import {
  CapabilityDeniedError,
  requireCapability,
} from "../../../../../src/lib/devices/capability-gate.ts";
import {
  type ChargerRow,
  loadChargerRow,
} from "../../../../../src/lib/chargers/online.ts";
import { logger } from "../../../../../src/lib/utils/logger.ts";

const log = logger.child("AdminDeviceChargerReservations");

const ADMIN_BLACKOUT_ID_TAG = "admin-blackout";
const RESERVATION_LIMIT = 20;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export interface ReservationRow {
  reservationId: string;
  startsAt: string;
  endsAt: string;
  customerLabel: string | null;
  isBlackout: boolean;
  idTag: string | null;
  isCancelable: boolean;
}

// ---------------------------------------------------------------------------
// Test seams
// ---------------------------------------------------------------------------

interface ReservationListRow {
  id: number;
  steveOcppTagPk: number;
  steveOcppIdTag: string;
  startAt: Date;
  endAt: Date;
  status: string;
}

type ReservationsLoader = (
  chargeBoxId: string,
) => Promise<ReservationListRow[]>;
type CustomerLabelsLoader = (
  ocppTagPks: number[],
) => Promise<Map<number, string | null>>;
type ChargerLoader = (chargerId: string) => Promise<ChargerRow | null>;

const defaultReservationsLoader: ReservationsLoader = async (chargeBoxId) => {
  const rows = await listUpcomingByCharger(chargeBoxId, {
    limit: RESERVATION_LIMIT,
    upcomingOnly: true,
    statuses: ["pending", "confirmed", "active"],
  });
  return rows.map((r) => ({
    id: r.id,
    steveOcppTagPk: r.steveOcppTagPk,
    steveOcppIdTag: r.steveOcppIdTag,
    startAt: r.startAt,
    endAt: r.endAt,
    status: r.status,
  }));
};

const defaultCustomerLabelsLoader: CustomerLabelsLoader = async (
  ocppTagPks,
) => {
  const out = new Map<number, string | null>();
  if (ocppTagPks.length === 0) return out;
  const rows = await db
    .select({
      tagPk: userMappings.steveOcppTagPk,
      displayName: userMappings.displayName,
      lagoId: userMappings.lagoCustomerExternalId,
    })
    .from(userMappings)
    .where(inArray(userMappings.steveOcppTagPk, ocppTagPks));
  for (const r of rows) {
    out.set(r.tagPk, r.displayName ?? r.lagoId ?? null);
  }
  return out;
};

let reservationsLoader: ReservationsLoader = defaultReservationsLoader;
let customerLabelsLoader: CustomerLabelsLoader = defaultCustomerLabelsLoader;
let chargerLoader: ChargerLoader = (id) => loadChargerRow(id);

export function _setReservationsLoaderForTests(
  fn: ReservationsLoader | null,
): void {
  reservationsLoader = fn ?? defaultReservationsLoader;
}
export function _setCustomerLabelsLoaderForTests(
  fn: CustomerLabelsLoader | null,
): void {
  customerLabelsLoader = fn ?? defaultCustomerLabelsLoader;
}
export function _setChargerLoaderForTests(fn: ChargerLoader | null): void {
  chargerLoader = fn ?? ((id) => loadChargerRow(id));
}
export function _resetReservationsTestSeams(): void {
  reservationsLoader = defaultReservationsLoader;
  customerLabelsLoader = defaultCustomerLabelsLoader;
  chargerLoader = (id) => loadChargerRow(id);
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const handler = define.handlers({
  async GET(ctx) {
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
      return jsonResponse(404, { error: "not_found" });
    }

    let charger: ChargerRow | null;
    try {
      charger = await chargerLoader(chargerId);
    } catch (err) {
      log.error("Charger lookup failed", {
        chargerId,
        error: err instanceof Error ? err.message : String(err),
      });
      return jsonResponse(500, { error: "internal_error" });
    }
    if (!charger) return jsonResponse(404, { error: "not_found" });

    let rows: ReservationListRow[];
    try {
      rows = await reservationsLoader(chargerId);
    } catch (err) {
      log.error("Reservations lookup failed", {
        chargerId,
        error: err instanceof Error ? err.message : String(err),
      });
      return jsonResponse(500, { error: "internal_error" });
    }

    const tagPks = Array.from(
      new Set(
        rows
          .filter((r) => r.steveOcppIdTag !== ADMIN_BLACKOUT_ID_TAG)
          .map((r) => r.steveOcppTagPk),
      ),
    );
    const labels = await customerLabelsLoader(tagPks);

    const out: ReservationRow[] = rows.map((r) => {
      const isBlackout = r.steveOcppIdTag === ADMIN_BLACKOUT_ID_TAG;
      return {
        reservationId: String(r.id),
        startsAt: r.startAt.toISOString(),
        endsAt: r.endAt.toISOString(),
        customerLabel: isBlackout ? null : labels.get(r.steveOcppTagPk) ?? null,
        isBlackout,
        idTag: isBlackout ? null : r.steveOcppIdTag,
        // Friends-and-family scope: every upcoming row is cancellable
        // under `user`. Customer-token rollout flips this per-row.
        isCancelable: true,
      };
    });

    return jsonResponse(200, { reservations: out });
  },
});

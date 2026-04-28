/**
 * ExpresScan v2 / Wave 6 Slice J — admin charger session GET.
 *
 * GET /api/admin/devices/{deviceId}/session
 *
 * Bearer-auth'd device-API endpoint. Returns the active session on the
 * charger keyed by `chargeBoxId`. The customer-portal session route
 * (`/api/customer/sessions/[id]`) is user-scoped and looks up by
 * `synced_transaction_events.id` filtered by the caller's `mappingIds`;
 * that's the wrong key shape for "which session is currently active on
 * this charger?".
 *
 * Implementation: StEvE is the source of truth for active sessions, so
 * we ask StEvE directly via `getTransactions({chargeBoxId, type: ACTIVE})`
 * — the same call the auto-stop service uses (see
 * `src/services/auto-stop.service.ts:124`). We then enrich with the
 * customer label from `user_mappings` and the meter delta from our own
 * `synced_transaction_events` mirror so iOS can show kWh-delivered
 * without a second round trip.
 *
 * Response: `200` with the envelope below; body is `null` when no
 * active session is on the charger. `404` only when the charger row
 * itself doesn't exist.
 *
 *   type ChargerSession = {
 *     chargerId: string;
 *     sessionId: string | null;
 *     state: "idle" | "preparing" | "charging" | "stopping" | "outOfService";
 *     startedAt: string | null;
 *     idTag: string | null;
 *     customerName: string | null;
 *     kwh: number | null;
 *     kw: number | null;
 *     elapsedSec: number | null;
 *     connectorId: number | null;
 *   } | null
 */

import { desc, eq } from "drizzle-orm";
import { define } from "../../../../../utils.ts";
import { db } from "../../../../../src/db/index.ts";
import {
  syncedTransactionEvents,
  userMappings,
} from "../../../../../src/db/schema.ts";
import { steveClient } from "../../../../../src/lib/steve-client.ts";
import type { StEvETransaction } from "../../../../../src/lib/types/steve.ts";
import {
  CapabilityDeniedError,
  requireCapability,
} from "../../../../../src/lib/devices/capability-gate.ts";
import {
  type ChargerRow,
  loadChargerRow,
} from "../../../../../src/lib/chargers/online.ts";
import { logger } from "../../../../../src/lib/utils/logger.ts";

const log = logger.child("AdminDeviceChargerSession");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export type ChargerSessionState =
  | "idle"
  | "preparing"
  | "charging"
  | "stopping"
  | "outOfService";

export interface ChargerSession {
  chargerId: string;
  sessionId: string | null;
  state: ChargerSessionState;
  startedAt: string | null;
  idTag: string | null;
  customerName: string | null;
  kwh: number | null;
  kw: number | null;
  elapsedSec: number | null;
  connectorId: number | null;
}

/**
 * Map StEvE's `last_status` text to our compact state enum. StEvE follows
 * OCPP 1.6 status notifications; the mapping here covers the values we've
 * actually seen in the field. Unknown values fall through to `"idle"` so
 * the UI doesn't break on a previously-unseen vendor extension.
 */
function mapStatus(
  lastStatus: string | null,
  hasActiveTxn: boolean,
): ChargerSessionState {
  if (hasActiveTxn) return "charging";
  switch (lastStatus) {
    case "Available":
      return "idle";
    case "Preparing":
      return "preparing";
    case "Charging":
    case "SuspendedEV":
    case "SuspendedEVSE":
      return "charging";
    case "Finishing":
      return "stopping";
    case "Faulted":
    case "Unavailable":
      return "outOfService";
    default:
      return "idle";
  }
}

// ---------------------------------------------------------------------------
// Test seams
// ---------------------------------------------------------------------------

type ActiveTxnFinder = (
  chargeBoxId: string,
) => Promise<StEvETransaction | null>;
type CustomerLabelLoader = (
  ocppTagPk: number,
) => Promise<string | null>;
type MeterTotalsLoader = (steveTransactionId: number) => Promise<
  {
    kwh: number;
    lastSyncedAt: Date | null;
  } | null
>;

const defaultActiveTxnFinder: ActiveTxnFinder = async (chargeBoxId) => {
  const txs = await steveClient.getTransactions({
    chargeBoxId,
    type: "ACTIVE",
  });
  return txs[0] ?? null;
};

const defaultCustomerLabelLoader: CustomerLabelLoader = async (ocppTagPk) => {
  const [row] = await db
    .select({
      displayName: userMappings.displayName,
      lagoCustomerExternalId: userMappings.lagoCustomerExternalId,
    })
    .from(userMappings)
    .where(eq(userMappings.steveOcppTagPk, ocppTagPk))
    .limit(1);
  return row?.displayName ?? row?.lagoCustomerExternalId ?? null;
};

const defaultMeterTotalsLoader: MeterTotalsLoader = async (
  steveTransactionId,
) => {
  // Our `synced_transaction_events` mirror tracks per-event deltas; sum
  // them to get total kWh delivered so far for the in-progress session.
  // We sort newest-first so we can grab the most recent `syncedAt` for
  // the kW estimate.
  const rows = await db
    .select({
      kwhDelta: syncedTransactionEvents.kwhDelta,
      meterValueFrom: syncedTransactionEvents.meterValueFrom,
      meterValueTo: syncedTransactionEvents.meterValueTo,
      syncedAt: syncedTransactionEvents.syncedAt,
    })
    .from(syncedTransactionEvents)
    .where(
      eq(syncedTransactionEvents.steveTransactionId, steveTransactionId),
    )
    .orderBy(desc(syncedTransactionEvents.syncedAt));
  if (rows.length === 0) return null;
  let kwh = 0;
  for (const r of rows) {
    const v = typeof r.kwhDelta === "string"
      ? Number.parseFloat(r.kwhDelta)
      : Number(r.kwhDelta);
    if (Number.isFinite(v)) kwh += v;
  }
  return { kwh, lastSyncedAt: rows[0].syncedAt };
};

let activeTxnFinder: ActiveTxnFinder = defaultActiveTxnFinder;
let customerLabelLoader: CustomerLabelLoader = defaultCustomerLabelLoader;
let meterTotalsLoader: MeterTotalsLoader = defaultMeterTotalsLoader;
type ChargerLoader = (chargerId: string) => Promise<ChargerRow | null>;
let chargerLoader: ChargerLoader = (id) => loadChargerRow(id);

export function _setActiveTxnFinderForTests(
  fn: ActiveTxnFinder | null,
): void {
  activeTxnFinder = fn ?? defaultActiveTxnFinder;
}
export function _setCustomerLabelLoaderForTests(
  fn: CustomerLabelLoader | null,
): void {
  customerLabelLoader = fn ?? defaultCustomerLabelLoader;
}
export function _setMeterTotalsLoaderForTests(
  fn: MeterTotalsLoader | null,
): void {
  meterTotalsLoader = fn ?? defaultMeterTotalsLoader;
}
export function _setChargerLoaderForTests(fn: ChargerLoader | null): void {
  chargerLoader = fn ?? ((id) => loadChargerRow(id));
}
export function _resetSessionTestSeams(): void {
  activeTxnFinder = defaultActiveTxnFinder;
  customerLabelLoader = defaultCustomerLabelLoader;
  meterTotalsLoader = defaultMeterTotalsLoader;
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

    let active: StEvETransaction | null = null;
    try {
      active = await activeTxnFinder(chargerId);
    } catch (err) {
      // StEvE outage shouldn't fail the whole call — fall back to the
      // cached status. iOS shows a degraded view until StEvE comes back.
      log.warn("Active-txn lookup failed; returning cached status only", {
        chargerId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const state = mapStatus(charger.lastStatus, active !== null);

    if (!active) {
      // No active session — body is null. Wrap in an envelope so the iOS
      // decoder always finds a `session` key (Swift Decoder dislikes
      // `null` at the top level when the type is non-optional).
      return jsonResponse(200, {
        session: null,
        state,
        chargerId,
      });
    }

    const startedAtIso = active.startTimestamp;
    const startedAtMs = Date.parse(startedAtIso);
    const elapsedSec = Number.isFinite(startedAtMs)
      ? Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000))
      : null;

    const customerName = await customerLabelLoader(active.ocppTagPk);
    const totals = await meterTotalsLoader(active.id);

    let kw: number | null = null;
    if (
      totals &&
      totals.lastSyncedAt &&
      elapsedSec !== null &&
      elapsedSec > 0
    ) {
      // Coarse instantaneous-power estimate: total kWh / elapsed hours.
      // The iOS UI re-derives this on the client when we ship a richer
      // meter-timeline endpoint; for now this is the single-number
      // approximation the customer sees on the hero.
      kw = totals.kwh / (elapsedSec / 3600);
      if (!Number.isFinite(kw)) kw = null;
    }

    const session: ChargerSession = {
      chargerId,
      sessionId: String(active.id),
      state,
      startedAt: startedAtIso,
      idTag: active.ocppIdTag,
      customerName,
      kwh: totals ? totals.kwh : null,
      kw: kw !== null ? Number(kw.toFixed(2)) : null,
      elapsedSec,
      connectorId: active.connectorId,
    };
    return jsonResponse(200, { session, state, chargerId });
  },
});

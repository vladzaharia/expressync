/**
 * ExpresScan v2 / Wave 6 Slice J — charger online preflight.
 *
 * Single source of truth for "is this charger online right now?" used by
 * the admin charger-control endpoints (start, stop, cancel-reservation).
 * Returns the charger row when online; throws `ChargerOfflineError`
 * (status 409) when the charger row exists but its connection state is
 * stale; throws `ChargerNotFoundError` (status 404) when no row exists.
 *
 * Online cutoff: `lastStatusAt` within 90 s of now. Mirrors the
 * `routes/api/admin/devices/[deviceId]/scan-arm.ts` 90 s window so the
 * iOS UI's "is online" bubble stays consistent across device kinds.
 */

import { eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { chargersCache } from "../../db/schema.ts";

/** 90 s cutoff — matches the scan-arm online window for app devices. */
export const CHARGER_ONLINE_WINDOW_MS = 90 * 1000;

export interface ChargerRow {
  chargeBoxId: string;
  chargeBoxPk: number | null;
  friendlyName: string | null;
  lastSeenAt: Date | null;
  lastStatus: string | null;
  lastStatusAt: Date | null;
}

export class ChargerNotFoundError extends Error {
  readonly status = 404;
  constructor(public readonly chargerId: string) {
    super(`Charger not found: ${chargerId}`);
    this.name = "ChargerNotFoundError";
  }
}

export class ChargerOfflineError extends Error {
  readonly status = 409;
  constructor(
    public readonly chargerId: string,
    public readonly lastSeenAt: Date | null,
  ) {
    super(`Charger offline: ${chargerId}`);
    this.name = "ChargerOfflineError";
  }
}

type ChargerLoader = (chargeBoxId: string) => Promise<ChargerRow | null>;

const defaultChargerLoader: ChargerLoader = async (chargeBoxId) => {
  const [row] = await db
    .select({
      chargeBoxId: chargersCache.chargeBoxId,
      chargeBoxPk: chargersCache.chargeBoxPk,
      friendlyName: chargersCache.friendlyName,
      lastSeenAt: chargersCache.lastSeenAt,
      lastStatus: chargersCache.lastStatus,
      lastStatusAt: chargersCache.lastStatusAt,
    })
    .from(chargersCache)
    .where(eq(chargersCache.chargeBoxId, chargeBoxId))
    .limit(1);
  return row ?? null;
};

let chargerLoader: ChargerLoader = defaultChargerLoader;

/** Test-only — install a fake charger loader. Pass `null` to restore. */
export function _setChargerLoaderForTests(fn: ChargerLoader | null): void {
  chargerLoader = fn ?? defaultChargerLoader;
}

/** Test-only — restore the default loader. */
export function _resetChargerOnlineTestSeams(): void {
  chargerLoader = defaultChargerLoader;
}

/**
 * Look up a charger row by `charge_box_id`. Returns null on miss; the
 * caller decides whether to 404 or surface a different shape.
 */
export async function loadChargerRow(
  chargeBoxId: string,
): Promise<ChargerRow | null> {
  return await chargerLoader(chargeBoxId);
}

/**
 * Returns `true` when `lastStatusAt` is within the 90 s window. Falls
 * back to `lastSeenAt` when `lastStatusAt` is null (StEvE may not have
 * pushed a status yet on a brand-new charger).
 */
export function isChargerOnline(row: ChargerRow): boolean {
  const candidate = row.lastStatusAt ?? row.lastSeenAt;
  if (!candidate) return false;
  return Date.now() - candidate.getTime() <= CHARGER_ONLINE_WINDOW_MS;
}

/**
 * Look up the charger row, throw `ChargerNotFoundError` on miss, throw
 * `ChargerOfflineError` when the connection state is stale, otherwise
 * return the row. Used by start / stop / cancel-reservation.
 */
export async function requireOnlineCharger(
  chargeBoxId: string,
): Promise<ChargerRow> {
  const row = await loadChargerRow(chargeBoxId);
  if (!row) throw new ChargerNotFoundError(chargeBoxId);
  if (!isChargerOnline(row)) {
    throw new ChargerOfflineError(
      chargeBoxId,
      row.lastStatusAt ?? row.lastSeenAt,
    );
  }
  return row;
}

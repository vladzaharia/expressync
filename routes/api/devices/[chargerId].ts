/**
 * GET /api/devices/{chargerId}
 *
 * Single-charger detail endpoint, mirroring `/api/devices` (the list)
 * but for one row. Used by the iOS app's universal-link landing flow:
 * when a user taps a sticker on an unmanaged charger and the chargers
 * list isn't loaded yet, the app fetches just this row to render the
 * detail view without waiting for a full list refresh.
 *
 * Bearer-authenticated and gated by the `user` capability, same as the
 * list endpoint.
 */

import { eq } from "drizzle-orm";
import { define } from "../../../utils.ts";
import { db } from "../../../src/db/index.ts";
import { chargersCache } from "../../../src/db/schema.ts";
import {
  CapabilityDeniedError,
  requireCapability,
} from "../../../src/lib/devices/capability-gate.ts";
import { logger } from "../../../src/lib/utils/logger.ts";
import { type ChargerRow, mapChargerState } from "./index.ts";
import { formatChargerAddress } from "../../../src/lib/charger/format-address.ts";

const CHARGER_STATES = [
  "idle",
  "preparing",
  "charging",
  "reserved",
  "outOfService",
  "offline",
] as const;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function toMs(v: string | Date | null): number | null {
  if (v === null) return null;
  if (v instanceof Date) return v.getTime();
  const n = Date.parse(v);
  return Number.isFinite(n) ? n : null;
}

function toIso(v: string | Date | null): string | null {
  if (v === null) return null;
  if (v instanceof Date) return v.toISOString();
  const n = Date.parse(v);
  return Number.isFinite(n) ? new Date(n).toISOString() : null;
}

const FORM_FACTORS = ["wallbox", "tesla", "generic"] as const;
type WireFormFactor = (typeof FORM_FACTORS)[number];

function normalizeFormFactor(v: string | null): WireFormFactor {
  if (v === "tesla" || v === "generic") return v;
  // Migration 0045: legacy pulsar/commander/wall_mount collapse to
  // wallbox; everything else also lands on the safe default.
  return "wallbox";
}

const CONNECTOR_TYPES = ["ccs", "j1772", "nacs", "chademo", "type2"] as const;
type WireConnectorType = (typeof CONNECTOR_TYPES)[number];

function normalizeConnectorType(v: string | null): WireConnectorType | null {
  return (CONNECTOR_TYPES as readonly string[]).includes(v ?? "")
    ? (v as WireConnectorType)
    : null;
}

function parseMaxKw(v: string | null): number | null {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const log = logger;

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

    const chargerId = ctx.params.chargerId;
    if (!chargerId) {
      return jsonResponse(400, { error: "chargerId is required" });
    }

    let row: typeof chargersCache.$inferSelect | undefined;
    try {
      [row] = await db
        .select()
        .from(chargersCache)
        .where(eq(chargersCache.chargeBoxId, chargerId))
        .limit(1);
    } catch (err) {
      log.error("API", "single-charger fetch failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return jsonResponse(500, { error: "internal" });
    }

    if (!row) {
      return jsonResponse(404, { error: "not_found" });
    }

    const isUnmanaged = row.managementMode === "unmanaged";
    const caps = new Set(row.capabilities ?? []);
    caps.add("charger");

    const address = formatChargerAddress({
      addressLine1: row.addressLine1,
      addressLine2: row.addressLine2,
      addressCity: row.addressCity,
      addressRegion: row.addressRegion,
      addressPostalCode: row.addressPostalCode,
      addressCountry: row.addressCountry,
    });
    const lat = row.latitude != null ? Number(row.latitude) : null;
    const lon = row.longitude != null ? Number(row.longitude) : null;

    const charger: ChargerRow = {
      chargerId: row.chargeBoxId,
      label: row.friendlyName ?? row.chargeBoxId,
      siteName: null,
      formFactor: normalizeFormFactor(row.formFactor),
      connectorType: normalizeConnectorType(row.connectorTypeOverride),
      maxKw: parseMaxKw(row.maxKwOverride),
      lastSeenAt: toIso(row.lastStatusAt),
      capabilities: Array.from(caps),
    };
    if (row.publicId) charger.publicId = row.publicId;
    if (address) charger.address = address;
    if (lat != null && Number.isFinite(lat)) charger.latitude = lat;
    if (lon != null && Number.isFinite(lon)) charger.longitude = lon;

    if (!isUnmanaged) {
      const mapped = mapChargerState(
        row.lastStatus,
        toMs(row.lastStatusAt),
        Date.now(),
      );
      // Sanity check the wire enum (kept for future-proofing if
      // someone edits the chargers_cache row directly).
      charger.state = (CHARGER_STATES as readonly string[]).includes(mapped)
        ? mapped
        : "offline";
    } else {
      charger.managementMode = "unmanaged";
      // Unmanaged chargers omit `state` — the iOS detail view renders
      // no status pill in that case.
    }

    return jsonResponse(200, { charger });
  },
});

/**
 * ExpresScan v2 / Wave 6 Slice D + Slice O —
 * admin capability PATCH (devices + chargers).
 *
 * PATCH /api/admin/devices/{deviceId}/capabilities
 *   Body (strict): { capabilities: DeviceCapability[] }
 *
 * Two id shapes are accepted on the same path:
 *
 *   - UUID-shaped `{deviceId}` → operates on the `devices` row. Body must
 *     satisfy `validateCapabilitySet`; `'charger'` is rejected with
 *     `capability_charger_immutable` (apps can never carry `charger`).
 *
 *   - Non-UUID-shaped `{deviceId}` → operates on the `chargers`
 *     row keyed by `charge_box_id` (Slice O). The charger-side rules
 *     differ:
 *       - `'charger'` is auto-on; missing it server-side is auto-added.
 *       - `'scanner'` is the only admin-editable token.
 *       - `'user'` / `'kiosk'` / legacy `'management'` are rejected
 *         (`capability_not_charger_eligible`); the DB CHECK enforces
 *         the same invariant.
 *
 * On success:
 *   - Emits `device.capabilities.changed` SSE event so the matching
 *     device's open `scan-stream` connection refreshes its envelope
 *     (≤ ~1s). Chargers don't have their own SSE stream, so the event
 *     is a no-op for charger ids — the bus still fires it for parity
 *     with the audit log; nothing subscribes on the charger side.
 *   - Audits `device.capability.changed` with before/after sets.
 *
 * Auth: admin cookie (selectAuth lane in `routes/_middleware.ts`).
 *
 * Errors:
 *   401 unauthorized                          no cookie session
 *   403 forbidden                             non-admin role
 *   400 invalid_body / invalid_capabilities   Zod or legality
 *   400 capability_charger_immutable          devices: add/remove `charger`
 *   400 capability_not_charger_eligible       chargers: forbidden token
 *   404 not_found                             unknown deviceId / chargeBoxId
 *   410 device_revoked                        soft-deleted device row
 */

import { eq } from "drizzle-orm";
import { z } from "zod";
import { define } from "../../../../../utils.ts";
import { db } from "../../../../../src/db/index.ts";
import { chargers, devices } from "../../../../../src/db/schema.ts";
import {
  DEVICE_CAPABILITIES,
  type DeviceCapability,
} from "../../../../../src/lib/types/devices.ts";
import { validateCapabilitySet } from "../../../../../src/lib/devices/capability-gate.ts";
import { publishDeviceCapabilitiesChanged } from "../../../../../src/lib/devices/sse-publishers.ts";
import { logDeviceCapabilityChanged } from "../../../../../src/lib/audit.ts";
import { withIdempotency } from "../../../../../src/lib/idempotency.ts";
import { logger } from "../../../../../src/lib/utils/logger.ts";

const log = logger.child("AdminDeviceCapabilitiesPatch");
const ROUTE = "/api/admin/devices/[deviceId]/capabilities";

const BodySchema = z.object({
  capabilities: z.array(z.enum(DEVICE_CAPABILITIES)).min(1).max(8),
}).strict();

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

interface DeviceRow {
  id: string;
  capabilities: string[];
  deletedAt: Date | null;
  revokedAt: Date | null;
}

interface ChargerRow {
  chargeBoxId: string;
  capabilities: string[];
}

// Test seam — see scan-arm.ts for the rationale.
type DeviceLoader = (deviceId: string) => Promise<DeviceRow | null>;
type CapabilityWriter = (
  deviceId: string,
  capabilities: DeviceCapability[],
) => Promise<DeviceRow | null>;
type ChargerLoader = (chargeBoxId: string) => Promise<ChargerRow | null>;
type ChargerCapabilityWriter = (
  chargeBoxId: string,
  capabilities: DeviceCapability[],
) => Promise<ChargerRow | null>;

const defaultDeviceLoader: DeviceLoader = async (deviceId) => {
  const [row] = await db
    .select({
      id: devices.id,
      capabilities: devices.capabilities,
      deletedAt: devices.deletedAt,
      revokedAt: devices.revokedAt,
    })
    .from(devices)
    .where(eq(devices.id, deviceId))
    .limit(1);
  return row ?? null;
};

const defaultCapabilityWriter: CapabilityWriter = async (
  deviceId,
  capabilities,
) => {
  // The trailing `AND deleted_at IS NULL` is enforced by the route's
  // pre-check; we keep it on the UPDATE too so a delete-during-PATCH
  // race produces zero rows → 410 from the caller.
  const [updated] = await db
    .update(devices)
    .set({ capabilities })
    .where(eq(devices.id, deviceId))
    .returning({
      id: devices.id,
      capabilities: devices.capabilities,
      deletedAt: devices.deletedAt,
      revokedAt: devices.revokedAt,
    });
  return updated ?? null;
};

const defaultChargerLoader: ChargerLoader = async (chargeBoxId) => {
  const [row] = await db
    .select({
      chargeBoxId: chargers.chargeBoxId,
      capabilities: chargers.capabilities,
    })
    .from(chargers)
    .where(eq(chargers.chargeBoxId, chargeBoxId))
    .limit(1);
  return row ?? null;
};

const defaultChargerCapabilityWriter: ChargerCapabilityWriter = async (
  chargeBoxId,
  capabilities,
) => {
  const [updated] = await db
    .update(chargers)
    .set({ capabilities })
    .where(eq(chargers.chargeBoxId, chargeBoxId))
    .returning({
      chargeBoxId: chargers.chargeBoxId,
      capabilities: chargers.capabilities,
    });
  return updated ?? null;
};

let deviceLoader: DeviceLoader = defaultDeviceLoader;
let capabilityWriter: CapabilityWriter = defaultCapabilityWriter;
let chargerLoader: ChargerLoader = defaultChargerLoader;
let chargerCapabilityWriter: ChargerCapabilityWriter =
  defaultChargerCapabilityWriter;

export function _setDeviceLoaderForTests(fn: DeviceLoader | null): void {
  deviceLoader = fn ?? defaultDeviceLoader;
}
export function _setCapabilityWriterForTests(
  fn: CapabilityWriter | null,
): void {
  capabilityWriter = fn ?? defaultCapabilityWriter;
}
export function _setChargerLoaderForTests(fn: ChargerLoader | null): void {
  chargerLoader = fn ?? defaultChargerLoader;
}
export function _setChargerCapabilityWriterForTests(
  fn: ChargerCapabilityWriter | null,
): void {
  chargerCapabilityWriter = fn ?? defaultChargerCapabilityWriter;
}
export function _resetCapabilitiesPatchTestSeams(): void {
  deviceLoader = defaultDeviceLoader;
  capabilityWriter = defaultCapabilityWriter;
  chargerLoader = defaultChargerLoader;
  chargerCapabilityWriter = defaultChargerCapabilityWriter;
}

function getClientIp(req: Request): string | null {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    req.headers.get("cf-connecting-ip") ??
    null;
}

/**
 * Validate a charger-side capability set. Rules (Slice O):
 *   - `'charger'` must be present (auto-added by the caller before
 *     this function — we still defensively require it here).
 *   - No `'user'`, `'kiosk'`, `'management'`, `'tap'`, `'ev'`.
 *   - Only `'scanner'` is editable beyond the auto-on `'charger'`.
 *
 * Returns `{ ok: true }` or `{ ok: false, reason }` mirroring
 * `validateCapabilitySet`.
 */
function validateChargerCapabilitySet(
  caps: DeviceCapability[],
): { ok: true } | { ok: false; reason: string } {
  const set = new Set<string>(caps);
  if (!set.has("charger")) {
    return { ok: false, reason: "capability_charger_required" };
  }
  for (const c of set) {
    if (c === "charger" || c === "scanner") continue;
    return { ok: false, reason: "capability_not_charger_eligible" };
  }
  return { ok: true };
}

export const handler = define.handlers({
  async PATCH(ctx) {
    if (!ctx.state.user) return jsonResponse(401, { error: "unauthorized" });
    if (ctx.state.user.role !== "admin") {
      return jsonResponse(403, { error: "forbidden" });
    }
    const adminUserId = ctx.state.user.id;

    const deviceId = ctx.params.deviceId;
    if (!deviceId || deviceId.length < 1 || deviceId.length > 64) {
      return jsonResponse(404, { error: "not_found" });
    }

    return await withIdempotency(ctx, ROUTE, async () => {
      let parsed: { capabilities: DeviceCapability[] };
      try {
        const text = await ctx.req.text();
        if (text.trim() === "") {
          return jsonResponse(400, { error: "invalid_body" });
        }
        const raw = JSON.parse(text);
        parsed = BodySchema.parse(raw);
      } catch (err) {
        if (err instanceof z.ZodError) {
          return jsonResponse(400, {
            error: "invalid_body",
            issues: err.issues,
          });
        }
        return jsonResponse(400, { error: "invalid_body" });
      }
      const requested = parsed.capabilities;

      // Slice O: route by id shape. UUID → devices row; otherwise →
      // chargers row keyed by charge_box_id.
      if (isUuid(deviceId)) {
        return await handleDevicePatch({
          deviceId,
          requested,
          adminUserId,
          req: ctx.req,
        });
      }
      return await handleChargerPatch({
        chargeBoxId: deviceId,
        requested,
        adminUserId,
        req: ctx.req,
      });
    });
  },
});

async function handleDevicePatch(args: {
  deviceId: string;
  requested: DeviceCapability[];
  adminUserId: string;
  req: Request;
}): Promise<Response> {
  const { deviceId, requested, adminUserId, req } = args;

  let row: DeviceRow | null;
  try {
    row = await deviceLoader(deviceId);
  } catch (err) {
    log.error("device load failed", {
      deviceId,
      error: err instanceof Error ? err.message : String(err),
    });
    return jsonResponse(500, { error: "internal_error" });
  }
  if (!row) return jsonResponse(404, { error: "not_found" });
  if (row.deletedAt !== null) {
    return jsonResponse(410, { error: "device_revoked" });
  }

  const existing = new Set<string>(row.capabilities ?? []);
  const next = new Set<string>(requested);
  // `charger` is auto-managed; an admin must not add or remove it.
  if (existing.has("charger") !== next.has("charger")) {
    return jsonResponse(400, { error: "capability_charger_immutable" });
  }

  // Slice-B legality gate. The gate also rejects `charger` outright
  // on app-side writes — defense in depth alongside the immutability
  // check above.
  const legality = validateCapabilitySet(requested);
  if (!legality.ok) {
    return jsonResponse(400, {
      error: "invalid_capabilities",
      reason: legality.reason,
    });
  }

  let updated: DeviceRow | null;
  try {
    updated = await capabilityWriter(deviceId, requested);
  } catch (err) {
    log.error("capabilities update failed", {
      deviceId,
      error: err instanceof Error ? err.message : String(err),
    });
    return jsonResponse(500, { error: "internal_error" });
  }
  if (!updated || updated.deletedAt !== null) {
    return jsonResponse(410, { error: "device_revoked" });
  }

  // SSE publish + audit are both best-effort; never block the 200.
  try {
    publishDeviceCapabilitiesChanged(deviceId, requested);
  } catch (err) {
    log.warn("SSE publish failed (non-fatal)", {
      deviceId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  void logDeviceCapabilityChanged({
    userId: adminUserId,
    ip: getClientIp(req),
    ua: req.headers.get("user-agent"),
    route: ROUTE,
    metadata: {
      deviceId,
      kind: "device",
      before: Array.from(existing),
      after: requested,
      changedByUserId: adminUserId,
    },
  });

  return jsonResponse(200, {
    ok: true,
    deviceId,
    capabilities: requested,
  });
}

async function handleChargerPatch(args: {
  chargeBoxId: string;
  requested: DeviceCapability[];
  adminUserId: string;
  req: Request;
}): Promise<Response> {
  const { chargeBoxId, requested, adminUserId, req } = args;

  let row: ChargerRow | null;
  try {
    row = await chargerLoader(chargeBoxId);
  } catch (err) {
    log.error("charger load failed", {
      chargeBoxId,
      error: err instanceof Error ? err.message : String(err),
    });
    return jsonResponse(500, { error: "internal_error" });
  }
  if (!row) return jsonResponse(404, { error: "not_found" });

  // Auto-add `'charger'` server-side so a client that toggles only
  // `'scanner'` doesn't have to remember to keep the auto-on token.
  const next = Array.from(
    new Set<string>([...requested, "charger"]),
  ) as DeviceCapability[];

  const legality = validateChargerCapabilitySet(next);
  if (!legality.ok) {
    return jsonResponse(400, {
      error: "invalid_capabilities",
      reason: legality.reason,
    });
  }

  let updated: ChargerRow | null;
  try {
    updated = await chargerCapabilityWriter(chargeBoxId, next);
  } catch (err) {
    log.error("charger capabilities update failed", {
      chargeBoxId,
      error: err instanceof Error ? err.message : String(err),
    });
    return jsonResponse(500, { error: "internal_error" });
  }
  if (!updated) return jsonResponse(404, { error: "not_found" });

  // Chargers have no SSE stream of their own — the publish below fires
  // on the bus for parity with the device path and to keep audit/SSE
  // wiring symmetrical, but no subscriber receives it. (The
  // `tappable_devices` view re-reads `chargers.capabilities` on
  // its next query, so the effective cache-invalidation path is the
  // page reload triggered by the picker.)
  try {
    publishDeviceCapabilitiesChanged(chargeBoxId, next);
  } catch (err) {
    log.warn("SSE publish failed (non-fatal)", {
      chargeBoxId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  void logDeviceCapabilityChanged({
    userId: adminUserId,
    ip: getClientIp(req),
    ua: req.headers.get("user-agent"),
    route: ROUTE,
    metadata: {
      chargeBoxId,
      kind: "charger",
      before: row.capabilities ?? [],
      after: next,
      changedByUserId: adminUserId,
    },
  });

  return jsonResponse(200, {
    ok: true,
    deviceId: chargeBoxId,
    capabilities: next,
  });
}

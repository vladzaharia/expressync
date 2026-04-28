/**
 * ExpresScan v2 / Wave 6 Slice D — admin capability PATCH.
 *
 * PATCH /api/admin/devices/{deviceId}/capabilities
 *   Body (strict): { capabilities: DeviceCapability[] }
 *
 * Updates `devices.capabilities` after running the slice-B legality
 * gate (`validateCapabilitySet`). Rejects any attempt to add or remove
 * `'charger'` — that token is auto-managed by the StEvE-sync path and
 * appears only on `chargers_cache`-derived rows, never on `devices`.
 *
 * On success:
 *   - Emits `device.capabilities.changed` SSE event so the device's
 *     open `scan-stream` connection refreshes its envelope (≤ ~1s).
 *   - Audits `device.capability.changed` with before/after sets.
 *
 * Auth: admin cookie (selectAuth lane in `routes/_middleware.ts`).
 *
 * Errors:
 *   401 unauthorized                         no cookie session
 *   403 forbidden                            non-admin role
 *   400 invalid_body / invalid_capabilities  Zod or legality
 *   400 capability_charger_immutable         add/remove `charger` attempted
 *   404 not_found                            unknown deviceId
 *   410 device_revoked                       soft-deleted row
 */

import { eq } from "drizzle-orm";
import { z } from "zod";
import { define } from "../../../../../utils.ts";
import { db } from "../../../../../src/db/index.ts";
import { devices } from "../../../../../src/db/schema.ts";
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

function isLikelyUuid(s: string): boolean {
  return s.length >= 8 && s.length <= 64;
}

interface DeviceRow {
  id: string;
  capabilities: string[];
  deletedAt: Date | null;
  revokedAt: Date | null;
}

// Test seam — see scan-arm.ts for the rationale.
type DeviceLoader = (deviceId: string) => Promise<DeviceRow | null>;
type CapabilityWriter = (
  deviceId: string,
  capabilities: DeviceCapability[],
) => Promise<DeviceRow | null>;

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

let deviceLoader: DeviceLoader = defaultDeviceLoader;
let capabilityWriter: CapabilityWriter = defaultCapabilityWriter;

export function _setDeviceLoaderForTests(fn: DeviceLoader | null): void {
  deviceLoader = fn ?? defaultDeviceLoader;
}
export function _setCapabilityWriterForTests(
  fn: CapabilityWriter | null,
): void {
  capabilityWriter = fn ?? defaultCapabilityWriter;
}
export function _resetCapabilitiesPatchTestSeams(): void {
  deviceLoader = defaultDeviceLoader;
  capabilityWriter = defaultCapabilityWriter;
}

function getClientIp(req: Request): string | null {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    req.headers.get("cf-connecting-ip") ??
    null;
}

export const handler = define.handlers({
  async PATCH(ctx) {
    if (!ctx.state.user) return jsonResponse(401, { error: "unauthorized" });
    if (ctx.state.user.role !== "admin") {
      return jsonResponse(403, { error: "forbidden" });
    }
    const adminUserId = ctx.state.user.id;

    const deviceId = ctx.params.deviceId;
    if (!deviceId || !isLikelyUuid(deviceId)) {
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
        ip: getClientIp(ctx.req),
        ua: ctx.req.headers.get("user-agent"),
        route: ROUTE,
        metadata: {
          deviceId,
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
    });
  },
});

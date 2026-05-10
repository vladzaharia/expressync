/**
 * POST /api/admin/devices/{deviceId}/locate
 *
 * Phase 2 Bundle 2b — silent-push "Locate now". Tells the iOS device
 * to take an on-demand `requestLocation()` reading and flush it via
 * the next sync. The response returns immediately with a
 * `correlationId`; the actual location update arrives via the regular
 * sync envelope and surfaces on the device-details page once
 * `last_location_at` advances.
 *
 * Auth: admin cookie (middleware-enforced — see `routes/_middleware.ts`).
 *
 * Pre-flight checks (in order):
 *   1. Device exists and isn't soft-deleted.
 *   2. Device has the `managed` capability — customer-owned devices
 *      can never have this; admin-owned devices have it only when
 *      explicitly granted.
 *   3. Device has a registered APNs push token.
 *
 * Errors:
 *   400 not_managed         — device lacks `managed` capability
 *   404 not_found           — unknown deviceId / soft-deleted
 *   409 no_push_token       — device hasn't registered with APNs yet
 *   502 push_send_failed    — APNs returned non-200
 *   500 internal            — DB / unknown
 *
 * Response 202 body:
 *   { correlationId: string }   — UUID echoed back in the silent push
 *                                 payload; iOS resolves the LocateNow
 *                                 button against the matching SSE
 *                                 `device.location.changed` event.
 */

import { and, eq, isNull } from "drizzle-orm";
import { define } from "../../../../../utils.ts";
import { db } from "../../../../../src/db/index.ts";
import { devices } from "../../../../../src/db/schema.ts";
import { sendSilentApns } from "../../../../../src/lib/apns.ts";
import { logger } from "../../../../../src/lib/utils/logger.ts";

const log = logger.child("AdminDeviceLocate");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const handler = define.handlers({
  async POST(ctx) {
    const deviceId = ctx.params.deviceId as string | undefined;
    if (!deviceId) {
      return jsonResponse(400, { error: "missing_device_id" });
    }

    let row: {
      id: string;
      capabilities: string[];
      pushToken: string | null;
      apnsEnvironment: string | null;
    } | undefined;
    try {
      const [r] = await db
        .select({
          id: devices.id,
          capabilities: devices.capabilities,
          pushToken: devices.pushToken,
          apnsEnvironment: devices.apnsEnvironment,
        })
        .from(devices)
        .where(and(eq(devices.id, deviceId), isNull(devices.deletedAt)))
        .limit(1);
      row = r;
    } catch (err) {
      log.error("device load failed", {
        deviceId,
        error: err instanceof Error ? err.message : String(err),
      });
      return jsonResponse(500, { error: "internal" });
    }
    if (!row) return jsonResponse(404, { error: "not_found" });

    if (!(row.capabilities ?? []).includes("managed")) {
      return jsonResponse(400, { error: "not_managed" });
    }
    if (!row.pushToken) {
      return jsonResponse(409, { error: "no_push_token" });
    }
    const env = row.apnsEnvironment === "production" ? "production" : "sandbox";

    const correlationId = crypto.randomUUID();
    const result = await sendSilentApns(
      { pushToken: row.pushToken, environment: env },
      {
        // Coalesce repeated taps to a single push — Apple drops dups.
        collapseId: `device.locate:${deviceId}`,
        custom: {
          type: "device.locate",
          correlationId,
          // 30-second soft TTL — the iOS handler should respond within
          // a few seconds; older requests are stale.
          expiresAtSec: Math.floor(Date.now() / 1000) + 30,
        },
        expirationEpochSec: Math.floor(Date.now() / 1000) + 30,
      },
    );
    if (!result.ok) {
      log.warn("locate-now silent push failed", {
        deviceId,
        status: result.status,
        reason: result.reason,
      });
      return jsonResponse(502, {
        error: "push_send_failed",
        reason: result.reason,
      });
    }

    log.info("locate-now silent push sent", {
      deviceId,
      correlationId,
    });
    return jsonResponse(202, { correlationId });
  },
});

/**
 * GET /api/devices/me/state
 *
 * ExpresScan v2 / Wave 6 Slice C — full DeviceState envelope for the
 * bearer-authenticated device. Replaces the old single-purpose
 * `GET /api/devices/me` shape; the iOS coordinator (slice G) calls this
 * on cold-start, foreground, and SSE `device.{capabilities,settings}.changed`
 * events.
 *
 * Auth: bearer (`ctx.state.device` populated by `routes/_middleware.ts`).
 * Soft-deleted devices are filtered upstream; the 410 path here covers
 * the race window between middleware lookup and the SELECT in
 * `buildDeviceStateEnvelope`.
 *
 * Response shape: see `src/lib/devices/device-state.ts:DeviceStateSchema`.
 * Strict — never echoes raw push tokens, secret_hash, or revoked metadata.
 */

import { define } from "../../../../utils.ts";
import {
  buildDeviceStateEnvelope,
  DeviceDeletedError,
} from "../../../../src/lib/devices/device-state.ts";
import { logger } from "../../../../src/lib/utils/logger.ts";

const log = logger.child("DeviceMeState");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const handler = define.handlers({
  async GET(ctx) {
    const device = ctx.state.device;
    if (!device) {
      return jsonResponse(401, { error: "unauthorized" });
    }

    try {
      const envelope = await buildDeviceStateEnvelope(device.id);
      return jsonResponse(200, envelope);
    } catch (err) {
      if (err instanceof DeviceDeletedError) {
        return jsonResponse(410, { error: "device_deleted" });
      }
      log.error("Failed to build device-state envelope", {
        deviceId: device.id,
        error: err instanceof Error ? err.message : String(err),
      });
      return jsonResponse(500, { error: "internal" });
    }
  },
});

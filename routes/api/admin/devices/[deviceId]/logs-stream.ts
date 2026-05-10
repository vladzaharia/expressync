/**
 * GET /api/admin/devices/{deviceId}/logs-stream
 *
 * Phase 3c live-tail SSE for the admin device-logs viewer. Publishes
 * `device.logs.appended` events emitted by the sync route on every
 * successful bulk insert. Filtered by `deviceId` post-subscribe so a
 * single bus subscription serves every concurrent admin session.
 *
 * Auth: admin cookie (middleware-enforced).
 *
 * Protocol: standard SSE — one event per record. `data:` is the OTel
 * JSON record. `id:` is the per-event-bus seq so a reconnect can
 * resume via `Last-Event-ID`.
 *
 * Limits:
 *   - Reuses the existing 100-connection cap (`MAX_CONNECTIONS`).
 *     Beyond that the route 503s with `capacity_exhausted`.
 *   - Single-replica fan-out only (in-process LogBus). Multi-replica
 *     deployments need to broker through Postgres LISTEN/NOTIFY or
 *     Redis pubsub — out of scope for the friends-and-family
 *     deployment.
 */

import { and, eq, isNull } from "drizzle-orm";
import { define } from "../../../../../utils.ts";
import { db } from "../../../../../src/db/index.ts";
import { devices } from "../../../../../src/db/schema.ts";
import {
  openSseStream,
  parseLastEventId,
  sseDisabledResponse,
} from "../../../../../src/lib/sse.ts";
import { logger } from "../../../../../src/lib/utils/logger.ts";

const log = logger.child("AdminDeviceLogsStream");

export const handler = define.handlers({
  async GET(ctx) {
    const deviceId = ctx.params.deviceId as string | undefined;
    if (!deviceId) {
      return new Response(JSON.stringify({ error: "missing_device_id" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Verify the device exists and isn't soft-deleted before holding
    // an SSE connection slot.
    try {
      const [row] = await db
        .select({ id: devices.id })
        .from(devices)
        .where(and(eq(devices.id, deviceId), isNull(devices.deletedAt)))
        .limit(1);
      if (!row) {
        return new Response(JSON.stringify({ error: "not_found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
    } catch (err) {
      log.error("device verify failed", {
        deviceId,
        error: err instanceof Error ? err.message : String(err),
      });
      return new Response(JSON.stringify({ error: "internal" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const lastEventId = parseLastEventId(ctx.req);
    const response = openSseStream({
      types: ["device.logs.appended"],
      filter: (event) => {
        // Drop events for other devices.
        if (event.type !== "device.logs.appended") return false;
        const payload = event.payload as { deviceId?: unknown };
        return payload.deviceId === deviceId;
      },
      lastEventId,
      label: `device-logs:${deviceId}`,
      signal: ctx.req.signal,
    });
    if (!response) {
      return sseDisabledResponse("capacity_exhausted");
    }
    return response;
  },
});

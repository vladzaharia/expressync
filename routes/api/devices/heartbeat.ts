/**
 * POST /api/devices/heartbeat
 *
 * ExpresScan / Wave 2 Track B-lifecycle — bearer-only liveness ping.
 *
 * The iOS app calls this every ~5 minutes when the screen is active and on
 * APNs background-fetch wake-ups. The body is optional; when present we
 * persist `(batteryLevel, isCharging, networkType)` into `devices.last_status`
 * for ops dashboards. The payload is best-effort — invalid fields don't 4xx,
 * they're just dropped.
 *
 * Auth: bearer (`ctx.state.device` populated by Track A's `resolveBearer`).
 * The middleware already filters revoked tokens / soft-deleted devices, so
 * an authenticated request implies the device row is live.
 *
 * Idempotency: heartbeats are idempotent by definition; we still wrap in
 * `withIdempotency` so iOS can safely retry a network-blip with the same
 * `Idempotency-Key` and observe the cached 200.
 *
 * Errors:
 *   - 401 (unauthorized) — no valid bearer; emitted by the middleware.
 *   - 410 (gone) — fired when the device row was soft-deleted between the
 *                  middleware's check and the UPDATE (race). The middleware
 *                  filters `deletedAt IS NULL` already; this is belt-and-
 *                  braces in case a parallel DELETE landed.
 */

import { z } from "zod";
import { sql } from "drizzle-orm";
import { define } from "../../../utils.ts";
import { db } from "../../../src/db/index.ts";
import { withIdempotency } from "../../../src/lib/idempotency.ts";
import { logger } from "../../../src/lib/utils/logger.ts";

const log = logger.child("DeviceHeartbeat");

const HEARTBEAT_ROUTE = "/api/devices/heartbeat";

const heartbeatBodySchema = z.object({
  batteryLevel: z.number().min(0).max(1).optional(),
  isCharging: z.boolean().optional(),
  networkType: z.string().max(40).optional(),
}).strict();

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const handler = define.handlers({
  async POST(ctx) {
    return await withIdempotency(ctx, HEARTBEAT_ROUTE, async () => {
      const device = ctx.state.device;
      if (!device) {
        // Should never reach here — middleware blocks unauthenticated bearer
        // routes — but if it does, fail closed.
        return jsonResponse(401, { error: "unauthorized" });
      }

      // Body is optional. Reject only if present-and-malformed.
      let lastStatus: Record<string, unknown> | null = null;
      const text = await ctx.req.text();
      if (text.trim() !== "") {
        let raw: unknown;
        try {
          raw = JSON.parse(text);
        } catch {
          return jsonResponse(400, { error: "invalid_body" });
        }
        const parsed = heartbeatBodySchema.safeParse(raw);
        if (!parsed.success) {
          return jsonResponse(400, { error: "invalid_body" });
        }
        lastStatus = parsed.data;
      }

      // UPDATE last_seen_at (always) and last_status (when supplied). The
      // `WHERE deletedAt IS NULL` makes the race-against-deregister a clean
      // 410 instead of a phantom UPDATE on a soft-deleted row.
      let affected: { id: string }[];
      try {
        const result = await db.execute<{ id: string }>(sql`
          UPDATE devices
          SET last_seen_at = now(),
              last_status = ${
          lastStatus
            ? sql`${JSON.stringify(lastStatus)}::jsonb`
            : sql`last_status`
        }
          WHERE id = ${device.id}::uuid
            AND deleted_at IS NULL
          RETURNING id
        `);
        affected = (Array.isArray(result)
          ? result
          : (result as { rows?: { id: string }[] }).rows ?? []) as {
            id: string;
          }[];
      } catch (err) {
        log.error("Heartbeat UPDATE failed", {
          deviceId: device.id,
          error: err instanceof Error ? err.message : String(err),
        });
        return jsonResponse(500, { error: "internal" });
      }

      if (affected.length === 0) {
        // Race: device was soft-deleted between middleware lookup + this
        // UPDATE. Surface as 410 so the iOS app drops the bearer and
        // returns to the welcome screen.
        return jsonResponse(410, { error: "device_deleted" });
      }

      return jsonResponse(200, { ok: true });
    });
  },
});

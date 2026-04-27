/**
 * POST /api/devices/scan-cancel
 *
 * ExpresScan / Wave 2 Track B-lifecycle — bearer-only "the active scan
 * was dismissed on the device" notification. The iOS app POSTs this when
 * the user taps Cancel on the active-scan screen so the admin's
 * TapToAddModal can dismiss in real time, instead of waiting for the
 * 90 s pairing TTL to lapse.
 *
 * Body:
 *   `{ pairingCode: string }`
 *
 * Auth: bearer (`ctx.state.device` populated by Track A's `resolveBearer`).
 *
 * Behavior:
 *   1. Look up `verifications` by identifier
 *      `device-scan:{ctx.state.device.id}:{pairingCode}`.
 *   2. Atomic DELETE by identifier (idempotent — a 200 is also returned
 *      when the row is already gone, e.g. the admin cancelled at the
 *      same moment, or the row already expired).
 *   3. Publish `device.scan.cancelled` with `source: "device"` to the
 *      event-bus so the admin SSE stream + the device's own SSE stream
 *      (belt-and-braces — the device clears local state via the iOS
 *      coordinator's local cancel path, but the bus publish keeps the
 *      audit trail honest) both receive a uniform signal.
 *
 * Idempotency-Key support: wrapped in `withIdempotency` so a retry after
 * a network blip observes the cached 200.
 *
 * Errors:
 *   - 400 (invalid_body) — pairingCode missing / wrong type / wrong
 *                          shape.
 *   - 401 (unauthorized) — no valid bearer; emitted by the middleware.
 *
 * Note: there is intentionally no 404 for "no such pairing." The iOS
 * client cancels optimistically (it flips local state immediately and
 * fires this POST in the background); a stale-cancel arriving after the
 * row already cleared MUST NOT surface as a user-visible error.
 */

import { z } from "zod";
import { sql } from "drizzle-orm";
import { define } from "../../../utils.ts";
import { db } from "../../../src/db/index.ts";
import { withIdempotency } from "../../../src/lib/idempotency.ts";
import { logger } from "../../../src/lib/utils/logger.ts";
import { eventBus } from "../../../src/services/event-bus.service.ts";

const log = logger.child("DeviceScanCancel");

const ROUTE = "/api/devices/scan-cancel";

const cancelBodySchema = z.object({
  pairingCode: z.string().min(1).max(64),
}).strict();

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const handler = define.handlers({
  async POST(ctx) {
    return await withIdempotency(ctx, ROUTE, async () => {
      const device = ctx.state.device;
      if (!device) {
        return jsonResponse(401, { error: "unauthorized" });
      }
      const deviceId = device.id;

      // Body validation. `.strict()` rejects unknown fields so the
      // contract stays precise.
      let pairingCode: string;
      try {
        const text = await ctx.req.text();
        if (text.trim() === "") {
          return jsonResponse(400, { error: "invalid_body" });
        }
        const raw = JSON.parse(text);
        const parsed = cancelBodySchema.safeParse(raw);
        if (!parsed.success) {
          return jsonResponse(400, { error: "invalid_body" });
        }
        pairingCode = parsed.data.pairingCode;
      } catch {
        return jsonResponse(400, { error: "invalid_body" });
      }

      const identifier = `device-scan:${deviceId}:${pairingCode}`;

      // Atomic delete by identifier. The row is naturally scoped to
      // this device because `deviceId` is part of the key — an attacker
      // with another device's bearer can't cancel someone else's
      // pairing without knowing both ids.
      try {
        await db.execute(sql`
          DELETE FROM verifications
          WHERE identifier = ${identifier}
        `);
      } catch (err) {
        log.error("scan-cancel DELETE failed", {
          deviceId,
          error: err instanceof Error ? err.message : String(err),
        });
        return jsonResponse(500, { error: "internal" });
      }

      try {
        eventBus.publish({
          type: "device.scan.cancelled",
          payload: {
            deviceId,
            pairingCode,
            cancelledAt: Date.now(),
            source: "device",
          },
        });
      } catch (err) {
        log.warn("Event-bus publish failed (non-fatal)", {
          deviceId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      return jsonResponse(200, { ok: true });
    });
  },
});

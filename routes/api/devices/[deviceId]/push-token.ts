/**
 * PUT /api/devices/{deviceId}/push-token
 *
 * ExpresScan / Wave 2 Track B-lifecycle — bearer-authenticated push-token
 * update. Called by the iOS app after `application(_:didRegisterForRemoteNotificationsWithDeviceToken:)`
 * fires (initial register and after iOS rotates the token).
 *
 * Auth:
 *   - Bearer-only.
 *   - The bearer's deviceId MUST match the path `{deviceId}` — a different
 *     device cannot rotate another device's push token, even if they share
 *     an admin owner. 403 on mismatch.
 *
 * Body: `{ pushToken, apnsEnvironment }` — both required. `apnsEnvironment`
 * drives the APNs host the C-apns publisher selects (sandbox vs production).
 *
 * Errors mirror the DELETE endpoint:
 *   - 401, 403, 404 (malformed deviceId), 410 (already deleted).
 */

import { z } from "zod";
import { sql } from "drizzle-orm";
import { define } from "../../../../utils.ts";
import { db } from "../../../../src/db/index.ts";
import { withIdempotency } from "../../../../src/lib/idempotency.ts";
import { logger } from "../../../../src/lib/utils/logger.ts";

const log = logger.child("DevicePushToken");

const APNS_ENVIRONMENTS = ["sandbox", "production"] as const;

const pushTokenBodySchema = z.object({
  pushToken: z.string().min(1).max(512),
  apnsEnvironment: z.enum(APNS_ENVIRONMENTS),
});

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const handler = define.handlers({
  async PUT(ctx) {
    return await withIdempotency(
      ctx,
      "/api/devices/{deviceId}/push-token",
      async () => {
        const device = ctx.state.device;
        if (!device) {
          return jsonResponse(401, { error: "unauthorized" });
        }

        const pathDeviceId = ctx.params.deviceId;
        if (!pathDeviceId || !UUID_RE.test(pathDeviceId)) {
          return jsonResponse(404, { error: "not_found" });
        }
        if (device.id !== pathDeviceId) {
          log.warn("Cross-device push-token PUT attempt", {
            bearerDeviceId: device.id,
            pathDeviceId,
          });
          return jsonResponse(403, { error: "forbidden" });
        }

        let raw: unknown;
        try {
          raw = await ctx.req.json();
        } catch {
          return jsonResponse(400, { error: "invalid_body" });
        }
        const parsed = pushTokenBodySchema.safeParse(raw);
        if (!parsed.success) {
          return jsonResponse(400, { error: "invalid_body" });
        }
        const { pushToken, apnsEnvironment } = parsed.data;

        let affected: { id: string }[];
        try {
          const result = await db.execute<{ id: string }>(sql`
            UPDATE devices
            SET push_token = ${pushToken},
                apns_environment = ${apnsEnvironment}
            WHERE id = ${pathDeviceId}::uuid
              AND deleted_at IS NULL
            RETURNING id
          `);
          affected = (Array.isArray(result)
            ? result
            : (result as { rows?: { id: string }[] }).rows ?? []) as {
              id: string;
            }[];
        } catch (err) {
          log.error("push-token UPDATE failed", {
            deviceId: pathDeviceId,
            error: err instanceof Error ? err.message : String(err),
          });
          return jsonResponse(500, { error: "internal" });
        }
        if (affected.length === 0) {
          return jsonResponse(410, { error: "device_deleted" });
        }

        return jsonResponse(200, { ok: true });
      },
    );
  },
});

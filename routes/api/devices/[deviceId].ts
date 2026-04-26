/**
 * DELETE /api/devices/{deviceId}
 *
 * ExpresScan / Wave 2 Track B-lifecycle — bearer-authenticated self-deregister.
 *
 * The iOS app calls this when the user taps "Sign out this iPhone" in the
 * settings menu. The bearer's resolved deviceId MUST match the path
 * `{deviceId}` — anything else is a privilege escalation attempt and gets
 * a 403 (a device cannot self-deregister another device, even if both
 * happen to share an admin owner). Admin-side force-deregister lives at
 * `/api/admin/devices/{id}/deregister` (B-admin's territory).
 *
 * Wire model:
 *
 *   1. Soft-delete the device row (`deleted_at = now()`, `revoked_at = now()`).
 *      Soft delete because audit trail + future analytics outweigh storage.
 *   2. Revoke ALL device_tokens rows tied to the device (`revoked_at = now()`).
 *      Even though the schema currently only mints one token row per device,
 *      we revoke en bloc so a future re-issue path doesn't leak.
 *   3. Audit `device.deregistered` (actor = device-self via owner_user_id).
 *   4. Publish `device.token.revoked` so any open SSE stream tied to this
 *      device closes immediately. The C-stream listener subscribes by
 *      `(deviceId, tokenId)` and emits `event: revoked` then closes.
 *   5. Respond 200 with `{ ok: true }`.
 *
 * Errors:
 *   - 401 (unauthorized)  — invalid bearer (middleware short-circuits).
 *   - 403 (forbidden)     — bearer's deviceId doesn't match the path param.
 *   - 404 (not_found)     — path param malformed (not a UUID-shaped string).
 *   - 410 (gone)          — race: the device was already soft-deleted.
 */

import { eq, sql } from "drizzle-orm";
import { define } from "../../../utils.ts";
import { db } from "../../../src/db/index.ts";
import { deviceTokens } from "../../../src/db/schema.ts";
import { logDeviceDeregistered } from "../../../src/lib/audit.ts";
import { withIdempotency } from "../../../src/lib/idempotency.ts";
import { eventBus } from "../../../src/services/event-bus.service.ts";
import { logger } from "../../../src/lib/utils/logger.ts";

const log = logger.child("DeviceSelfDelete");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function getClientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    req.headers.get("cf-connecting-ip") ??
    "unknown";
}

/** UUID v4-shaped check (loose — db enforces strict). */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const handler = define.handlers({
  async DELETE(ctx) {
    return await withIdempotency(
      ctx,
      "/api/devices/{deviceId}",
      async () => {
        const device = ctx.state.device;
        if (!device) {
          return jsonResponse(401, { error: "unauthorized" });
        }

        const pathDeviceId = ctx.params.deviceId;
        if (!pathDeviceId || !UUID_RE.test(pathDeviceId)) {
          return jsonResponse(404, { error: "not_found" });
        }

        // Bearer's deviceId MUST equal the path. A foreign deviceId is a
        // privilege-escalation probe — answer 403 not 404 to make the
        // forensic distinction (admin force-deregister vs device-self
        // mistake-typo vs probe).
        if (device.id !== pathDeviceId) {
          log.warn("Cross-device DELETE attempt", {
            bearerDeviceId: device.id,
            pathDeviceId,
          });
          return jsonResponse(403, { error: "forbidden" });
        }

        // Step 1+2: atomic UPDATE of the device row + the token rows. We
        // run them as separate statements rather than one BEGIN/COMMIT
        // because the existing codebase doesn't use Drizzle's transaction
        // helper anywhere; the failure mode (row 1 ok, row 2 fails) is
        // a stranded device with `deleted_at` set but a live token —
        // bearer-auth's `isNull(devices.deletedAt)` guard refuses the
        // token anyway, so we're still secure. Worst case is a stale
        // `device_tokens.revoked_at IS NULL`; cleanup picks it up on
        // next reconcile.
        let deviceAffected: { id: string }[];
        try {
          const result = await db.execute<{ id: string }>(sql`
            UPDATE devices
            SET deleted_at = now(),
                revoked_at = now(),
                revoked_by_user_id = ${device.ownerUserId}
            WHERE id = ${pathDeviceId}::uuid
              AND deleted_at IS NULL
            RETURNING id
          `);
          deviceAffected = (Array.isArray(result)
            ? result
            : (result as { rows?: { id: string }[] }).rows ?? []) as {
              id: string;
            }[];
        } catch (err) {
          log.error("Soft-delete UPDATE on devices failed", {
            deviceId: pathDeviceId,
            error: err instanceof Error ? err.message : String(err),
          });
          return jsonResponse(500, { error: "internal" });
        }

        if (deviceAffected.length === 0) {
          // Race: another caller (admin, parallel DELETE) already
          // soft-deleted the row. Surface as 410.
          return jsonResponse(410, { error: "device_deleted" });
        }

        try {
          await db
            .update(deviceTokens)
            .set({ revokedAt: sql`now()` })
            .where(eq(deviceTokens.deviceId, pathDeviceId));
        } catch (err) {
          // Non-fatal: the device row's deleted_at already locks bearer
          // auth out via the `isNull(devices.deletedAt)` join filter. Log
          // for cleanup but proceed with the success response.
          log.warn(
            "device_tokens revoke failed; device still locked via devices.deleted_at",
            {
              deviceId: pathDeviceId,
              error: err instanceof Error ? err.message : String(err),
            },
          );
        }

        // Step 3: audit. Actor is the device's owner — see `60-security.md`
        // §12. Best-effort.
        const ip = getClientIp(ctx.req);
        const ua = ctx.req.headers.get("user-agent");
        void logDeviceDeregistered({
          userId: device.ownerUserId,
          ip,
          ua,
          route: `/api/devices/${pathDeviceId}`,
          metadata: {
            deviceId: pathDeviceId,
            tokenId: device.tokenId,
            reason: "self",
          },
        });

        // Step 4: publish revoked event. C-stream's SSE handler subscribes
        // on (deviceId, tokenId) and closes the stream on receipt.
        try {
          eventBus.publish({
            type: "device.token.revoked",
            payload: {
              deviceId: pathDeviceId,
              tokenId: device.tokenId,
              reason: "self",
            },
          });
        } catch (err) {
          log.warn("Event-bus publish failed", {
            error: err instanceof Error ? err.message : String(err),
          });
        }

        return jsonResponse(200, { ok: true });
      },
    );
  },
});

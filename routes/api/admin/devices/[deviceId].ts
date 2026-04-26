/**
 * ExpresScan / Wave 2 Track B-admin — admin device detail.
 *
 * GET /api/admin/devices/{deviceId}
 *
 * Direct query against the `devices` table (NOT the `tappable_devices`
 * view) so we can return the full set of columns, including token
 * metadata. Soft-deleted rows are still returned — admins need visibility
 * into deregistered devices for forensics.
 *
 * Sensitive fields are sanitized:
 *   - `pushToken` is masked to its last 8 characters only (never the full
 *     APNs token). Returned as `pushTokenLast8` so a UI can render
 *     "••••12345678" without ever holding the raw value.
 *   - The device's HMAC `secret` is never read from this endpoint at all.
 *
 * Token metadata (`tokenCount`, `activeTokenExpiresAt`, `revokedAt`) is
 * folded in via a sub-select on `device_tokens` — admins want to know
 * "how many bearers has this device minted" + "is the current one
 * revoked" at a glance.
 *
 * Auth: admin cookie. Bearer is rejected at the middleware layer.
 *
 * Errors: 401 (not admin), 404 (no row).
 */

import { eq, sql } from "drizzle-orm";
import { define } from "../../../../utils.ts";
import { db } from "../../../../src/db/index.ts";
import { devices, deviceTokens } from "../../../../src/db/schema.ts";
import { logger } from "../../../../src/lib/utils/logger.ts";

const log = logger.child("AdminDeviceDetail");

function unauthorized(): Response {
  return new Response(
    JSON.stringify({ error: "unauthorized" }),
    { status: 401, headers: { "Content-Type": "application/json" } },
  );
}

function notFound(): Response {
  return new Response(
    JSON.stringify({ error: "not_found" }),
    { status: 404, headers: { "Content-Type": "application/json" } },
  );
}

/**
 * Mask all but the last 8 chars of a (potentially long) APNs push token.
 * Returns null when the input is null/empty so callers can render a clean
 * "no push token registered yet" affordance.
 */
function maskPushToken(token: string | null): string | null {
  if (token === null || token.length === 0) return null;
  if (token.length <= 8) return token;
  return token.slice(-8);
}

function isoOrNull(v: Date | null | undefined): string | null {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

export const handler = define.handlers({
  async GET(ctx) {
    if (ctx.state.user?.role !== "admin") {
      return unauthorized();
    }

    const deviceId = ctx.params.deviceId;
    // UUIDs are 36 chars including hyphens; reject obviously bogus ids
    // before we hit the DB so a malformed URL doesn't waste a query.
    if (!deviceId || deviceId.length < 8 || deviceId.length > 64) {
      return notFound();
    }

    try {
      const [row] = await db
        .select({
          id: devices.id,
          kind: devices.kind,
          label: devices.label,
          capabilities: devices.capabilities,
          ownerUserId: devices.ownerUserId,
          platform: devices.platform,
          model: devices.model,
          osVersion: devices.osVersion,
          appVersion: devices.appVersion,
          pushToken: devices.pushToken,
          apnsEnvironment: devices.apnsEnvironment,
          lastSeenAt: devices.lastSeenAt,
          lastStatus: devices.lastStatus,
          registeredAt: devices.registeredAt,
          deletedAt: devices.deletedAt,
          revokedAt: devices.revokedAt,
          revokedByUserId: devices.revokedByUserId,
        })
        .from(devices)
        .where(eq(devices.id, deviceId))
        .limit(1);

      if (!row) {
        return notFound();
      }

      // Token rollup — count + active token expiry. We can't easily express
      // "the most recent non-revoked token's expiresAt" with a join+select
      // limit-1 in a single Drizzle call, so do a small targeted query.
      const tokenRows = await db
        .select({
          id: deviceTokens.id,
          expiresAt: deviceTokens.expiresAt,
          revokedAt: deviceTokens.revokedAt,
          createdAt: deviceTokens.createdAt,
        })
        .from(deviceTokens)
        .where(eq(deviceTokens.deviceId, row.id))
        .orderBy(sql`${deviceTokens.createdAt} DESC`);

      const tokenCount = tokenRows.length;
      const activeToken = tokenRows.find((t) => t.revokedAt === null);
      const activeTokenExpiresAt = isoOrNull(activeToken?.expiresAt ?? null);

      return new Response(
        JSON.stringify({
          ok: true,
          device: {
            deviceId: row.id,
            kind: row.kind,
            label: row.label,
            capabilities: row.capabilities,
            ownerUserId: row.ownerUserId,
            platform: row.platform,
            model: row.model,
            osVersion: row.osVersion,
            appVersion: row.appVersion,
            pushTokenLast8: maskPushToken(row.pushToken),
            apnsEnvironment: row.apnsEnvironment,
            lastSeenAtIso: isoOrNull(row.lastSeenAt),
            lastStatus: row.lastStatus,
            registeredAtIso: isoOrNull(row.registeredAt) ??
              new Date(0).toISOString(),
            deletedAtIso: isoOrNull(row.deletedAt),
            revokedAtIso: isoOrNull(row.revokedAt),
            revokedByUserId: row.revokedByUserId,
            tokenCount,
            activeTokenExpiresAt,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    } catch (err) {
      log.error("Failed to fetch device detail", {
        deviceId,
        error: err instanceof Error ? err.message : String(err),
      });
      return new Response(
        JSON.stringify({ error: "internal_error" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  },
});

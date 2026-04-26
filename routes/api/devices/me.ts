/**
 * GET /api/devices/me
 *
 * ExpresScan / Wave 2 Track B-lifecycle — bearer-only identity sanity check.
 *
 * Used by the iOS app on cold-start to verify the cached `(deviceToken,
 * deviceSecret)` pair is still valid AND to surface basic device metadata
 * (capabilities, label) for the home screen. Keeps the contract narrow —
 * never returns push tokens, raw secrets, or HMAC hashes.
 *
 * Auth: bearer (`ctx.state.device` populated by Track A's middleware). The
 * middleware filters revoked tokens / soft-deleted devices, so a successful
 * request guarantees the device row is live.
 *
 * Errors:
 *   - 401 (unauthorized) — emitted by middleware on missing/invalid bearer.
 *   - 410 (gone) — race between middleware lookup and the SELECT here.
 */

import { eq } from "drizzle-orm";
import { define } from "../../../utils.ts";
import { db } from "../../../src/db/index.ts";
import { devices, deviceTokens } from "../../../src/db/schema.ts";
import { logger } from "../../../src/lib/utils/logger.ts";

const log = logger.child("DeviceMe");

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

    let row:
      | {
        id: string;
        ownerUserId: string;
        capabilities: string[] | null;
        label: string;
        registeredAt: Date | string | null;
        deletedAt: Date | string | null;
        tokenExpiresAt: Date | string | null;
      }
      | undefined;
    try {
      const rows = await db
        .select({
          id: devices.id,
          ownerUserId: devices.ownerUserId,
          capabilities: devices.capabilities,
          label: devices.label,
          registeredAt: devices.registeredAt,
          deletedAt: devices.deletedAt,
          tokenExpiresAt: deviceTokens.expiresAt,
        })
        .from(devices)
        .innerJoin(deviceTokens, eq(deviceTokens.id, device.tokenId))
        .where(eq(devices.id, device.id))
        .limit(1);
      row = rows[0];
    } catch (err) {
      log.error("Failed to load device row", {
        deviceId: device.id,
        error: err instanceof Error ? err.message : String(err),
      });
      return jsonResponse(500, { error: "internal" });
    }

    if (!row || row.deletedAt) {
      return jsonResponse(410, { error: "device_deleted" });
    }

    const registeredAtIso = row.registeredAt instanceof Date
      ? row.registeredAt.toISOString()
      : new Date(row.registeredAt as string).toISOString();
    const expiresAtIso = row.tokenExpiresAt instanceof Date
      ? row.tokenExpiresAt.toISOString()
      : new Date(row.tokenExpiresAt as string).toISOString();

    return jsonResponse(200, {
      ok: true,
      deviceId: row.id,
      ownerUserId: row.ownerUserId,
      capabilities: row.capabilities ?? [],
      label: row.label,
      createdAtIso: registeredAtIso,
      expiresAtIso,
    });
  },
});

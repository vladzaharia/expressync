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

import { and, desc, eq, isNull } from "drizzle-orm";
import { define } from "../../../utils.ts";
import { db } from "../../../src/db/index.ts";
import {
  devices,
  deviceTokens,
  lagoPlans,
  lagoSubscriptions,
  users,
} from "../../../src/db/schema.ts";
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
        ownerRole: string;
        ownerLagoExternalId: string | null;
        capabilities: string[] | null;
        label: string;
        registeredAt: Date | string | null;
        deletedAt: Date | string | null;
        tokenExpiresAt: Date | string | null;
        ownerName: string | null;
        ownerEmail: string | null;
        ownerPublicId: string | null;
      }
      | undefined;
    try {
      const rows = await db
        .select({
          id: devices.id,
          ownerUserId: devices.ownerUserId,
          ownerRole: users.role,
          ownerLagoExternalId: users.lagoCustomerExternalId,
          capabilities: devices.capabilities,
          label: devices.label,
          registeredAt: devices.registeredAt,
          deletedAt: devices.deletedAt,
          tokenExpiresAt: deviceTokens.expiresAt,
          // The owner is always an admin user (devices_owner_must_be_admin
          // trigger enforces it). Pull the rendered identity bits so the
          // iOS Diagnostics → Account section can show name/email instead
          // of the raw user-id. `users` table doesn't carry a separate
          // `displayName`; we synthesize one server-side below.
          ownerName: users.name,
          ownerEmail: users.email,
          ownerPublicId: users.publicId,
        })
        .from(devices)
        .innerJoin(deviceTokens, eq(deviceTokens.id, device.tokenId))
        .innerJoin(users, eq(users.id, devices.ownerUserId))
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

    // Render-friendly identity for the iOS Diagnostics → Account
    // section. Priority: name → email → user id. The user-id is the
    // last-resort fallback when the BetterAuth user record carries
    // neither name nor email (rare but possible for auto-provisioned
    // rows). Never returns null.
    const ownerDisplayName: string = row.ownerName ??
      row.ownerEmail ??
      row.ownerUserId;

    // Phase 2 polish — surface the owner's plan tier so the iOS
    // Settings AccountIdentityCard can render a brand-tinted badge
    // ("ExpressCharge", "ExpressCharge+", "Admin", etc.). For admins
    // the role itself is the badge — skip the Lago lookup. For
    // customers, take the most-recently-active subscription's
    // planCode + the matching plan name.
    let planCode: string | null = null;
    let planName: string | null = null;
    if (row.ownerRole !== "admin" && row.ownerLagoExternalId) {
      try {
        const subRows = await db
          .select({
            planCode: lagoSubscriptions.planCode,
            startedAt: lagoSubscriptions.startedAt,
          })
          .from(lagoSubscriptions)
          .where(
            and(
              eq(
                lagoSubscriptions.externalCustomerId,
                row.ownerLagoExternalId,
              ),
              isNull(lagoSubscriptions.deletedAt),
              eq(lagoSubscriptions.status, "active"),
            ),
          )
          .orderBy(desc(lagoSubscriptions.startedAt))
          .limit(1);
        const code = subRows[0]?.planCode ?? null;
        if (code) {
          planCode = code;
          const planRows = await db
            .select({ name: lagoPlans.name })
            .from(lagoPlans)
            .where(eq(lagoPlans.code, code))
            .limit(1);
          planName = planRows[0]?.name ?? null;
        }
      } catch (err) {
        // Plan lookup is best-effort — never fail the whole `/me`
        // response on a Lago-side schema quirk.
        log.warn("plan lookup failed", {
          deviceId: device.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return jsonResponse(200, {
      ok: true,
      deviceId: row.id,
      ownerUserId: row.ownerUserId,
      ownerDisplayName,
      ownerName: row.ownerName,
      ownerEmail: row.ownerEmail,
      ownerPublicId: row.ownerPublicId,
      ownerRole: row.ownerRole,
      planCode,
      planName,
      capabilities: row.capabilities ?? [],
      label: row.label,
      registeredAtIso,
      // Legacy alias — iOS clients keyed on the old name during the
      // slice C → slice O transition. Remove once TestFlight build N
      // is rolled out everywhere.
      createdAtIso: registeredAtIso,
      expiresAtIso,
    });
  },
});

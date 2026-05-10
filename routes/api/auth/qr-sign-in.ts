/**
 * POST /api/auth/qr-sign-in — iOS-only QR sign-in entry point.
 *
 * Flow:
 *   1. iOS Camera scans the QR on a customer's printed card
 *      (`https://example.com/u/<publicId>`).
 *   2. AASA routes the URL to ExpresScan via Universal Link.
 *   3. ExpresScan POSTs to this endpoint with the user's public ID
 *      plus device-registration metadata. The publicId itself is the
 *      bearer credential — anyone who can scan the card signs in as
 *      that user. Acceptable for the friends-and-family deployment;
 *      mitigated by per-(publicId,IP) rate-limit + audit.
 *   4. Server mints a customer session AND registers the device + an
 *      auto-bound per-device OCPP tag in one round-trip, so the iOS
 *      app immediately has a token + secret + cookie ready to hit
 *      `/api/devices/me` and Mobile Start.
 *
 * Surface: customer host only (`example.com`). Admin host 404s
 * any attempt — `applinks:` is registered on both hosts but the
 * server-side endpoint is intentionally customer-only because the
 * sign-in path mints customer sessions, not admin sessions.
 *
 * NOT a BetterAuth plugin: the existing `polarisCustomerSessionPlugin`
 * already exposes `signInWithUserId`, which we call internally to
 * mint the session. Keeping this as a regular Fresh route puts the
 * device-registration + tag-minting logic next to the surface that
 * actually consumes it, rather than scattered across the
 * BetterAuth plugin tree.
 */

import { z } from "zod";
import { eq } from "drizzle-orm";
import { define } from "../../../utils.ts";
import { db } from "../../../src/db/index.ts";
import {
  type Device,
  devices,
  type DeviceToken,
  deviceTokens,
  users,
} from "../../../src/db/schema.ts";
import {
  DEVICE_TOKEN_TTL_MS,
  generateDeviceCredentials,
} from "../../../src/lib/devices/registration.ts";
import { ensureDeviceTag } from "../../../src/lib/customer-meta-tags.ts";
import { createCustomerSession } from "../../../src/lib/auth-helpers.ts";
import { customerCapabilityDefaults } from "../../../src/lib/auth/customer-capabilities.ts";
import { checkRateLimit } from "../../../src/lib/utils/rate-limit.ts";
import { isValidPublicId } from "../../../src/lib/utils/public-id.ts";
import {
  logDeviceRegistered,
  logDeviceTokenIssued,
} from "../../../src/lib/audit.ts";
import { logger } from "../../../src/lib/utils/logger.ts";

const log = logger.child("QrSignIn");

const ROUTE = "/api/auth/qr-sign-in";

const PLATFORMS = ["ios", "macos", "ipados"] as const;
const APNS_ENVIRONMENTS = ["sandbox", "production"] as const;

const bodySchema = z.object({
  userPublicId: z.string().refine(isValidPublicId, "invalid_public_id"),
  deviceLabel: z.string().min(1).max(120),
  platform: z.enum(PLATFORMS),
  model: z.string().min(1).max(80),
  osVersion: z.string().min(1).max(40),
  appVersion: z.string().min(1).max(40),
  pushToken: z.string().max(512).optional(),
  apnsEnvironment: z.enum(APNS_ENVIRONMENTS),
});

// 5 sign-ins per (publicId, IP) per minute — generous enough that a
// legitimate user reinstalling the app still works, tight enough that
// a stolen card can't churn through device registrations.
const RATE_LIMIT_PER_PUBLIC_ID_IP = 5;

function jsonResponse(
  status: number,
  body: unknown,
  extraHeaders?: Headers | Record<string, string>,
): Response {
  const headers = new Headers({
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    Pragma: "no-cache",
  });
  if (extraHeaders instanceof Headers) {
    for (const [k, v] of extraHeaders.entries()) headers.append(k, v);
  } else if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) headers.set(k, v);
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function getClientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    req.headers.get("cf-connecting-ip") ??
    "unknown";
}

export const handler = define.handlers({
  async POST(ctx) {
    // Customer-host only. The route classifier marks /api/auth/* PUBLIC,
    // but minting customer sessions on the admin host would let an
    // admin-host browser receive the customer cookie — defense-in-depth
    // hard reject.
    if (ctx.state.surface === "admin") {
      return jsonResponse(404, { error: "not_found" });
    }

    let body: z.infer<typeof bodySchema>;
    try {
      body = bodySchema.parse(await ctx.req.json());
    } catch {
      return jsonResponse(400, { error: "invalid_body" });
    }

    const ip = getClientIp(ctx.req);
    const rateLimitKey = `qrsignin:${body.userPublicId}:${ip}`;
    if (!await checkRateLimit(rateLimitKey, RATE_LIMIT_PER_PUBLIC_ID_IP)) {
      return jsonResponse(429, { error: "rate_limited" });
    }

    // Look up by publicId. We treat any failure (not found, banned,
    // wrong role) as a generic 404 so an attacker scanning random IDs
    // can't enumerate the user namespace.
    const [user] = await db
      .select({
        id: users.id,
        publicId: users.publicId,
        name: users.name,
        email: users.email,
        role: users.role,
      })
      .from(users)
      .where(eq(users.publicId, body.userPublicId))
      .limit(1);
    if (!user || user.role !== "customer") {
      return jsonResponse(404, { error: "not_found" });
    }

    // Device row first. owner_user_id = customer's id (migration 0047
    // relaxed the trigger to accept role IN (admin, customer)).
    const creds = await generateDeviceCredentials();
    let inserted: Device;
    try {
      const [row] = await db
        .insert(devices)
        .values({
          kind: "phone_nfc",
          label: body.deviceLabel.slice(0, 120),
          // Customer-registered devices land with the `user` capability
          // only — they can list chargers and Mobile Start, but not
          // scanner / kiosk. Admins keep the full picker via the
          // existing /api/devices/register path. Always go through the
          // shared helper so a future change (e.g. adding `notifications`)
          // ripples to every customer-mint surface in lockstep.
          capabilities: [...customerCapabilityDefaults()],
          ownerUserId: user.id,
          platform: body.platform,
          model: body.model,
          osVersion: body.osVersion,
          appVersion: body.appVersion,
          pushToken: body.pushToken ?? null,
          apnsEnvironment: body.apnsEnvironment,
        })
        .returning();
      if (!row) throw new Error("device insert returned no row");
      inserted = row;
    } catch (err) {
      log.error("device insert failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return jsonResponse(500, { error: "internal" });
    }

    // device_tokens row with the same credentials the iOS app stores
    // in Keychain.
    const expiresAt = new Date(Date.now() + DEVICE_TOKEN_TTL_MS);
    let tokenRow: DeviceToken;
    try {
      const [row] = await db
        .insert(deviceTokens)
        .values({
          deviceId: inserted.id,
          tokenHash: creds.deviceTokenHash,
          secret: creds.deviceSecret,
          expiresAt,
        })
        .returning();
      if (!row) throw new Error("device_tokens insert returned no row");
      tokenRow = row;
    } catch (err) {
      log.error("device_tokens insert failed; rolling back device", {
        deviceId: inserted.id,
        error: err instanceof Error ? err.message : String(err),
      });
      try {
        await db.delete(devices).where(eq(devices.id, inserted.id));
      } catch (rollbackErr) {
        log.error("rollback failed", {
          deviceId: inserted.id,
          error: rollbackErr instanceof Error
            ? rollbackErr.message
            : String(rollbackErr),
        });
      }
      return jsonResponse(500, { error: "internal" });
    }

    // Auto-mint per-device OCPP tag so iOS Mobile Start has a tag to
    // submit without requiring a picker. Best-effort — a StEvE outage
    // shouldn't block sign-in; the tag can be re-issued idempotently
    // on next request via `ensureDeviceTag` from the iOS app.
    try {
      await ensureDeviceTag(
        inserted.id,
        user.id,
        user.publicId,
        body.deviceLabel,
      );
    } catch (err) {
      log.warn("ensureDeviceTag failed during qr-sign-in", {
        deviceId: inserted.id,
        userId: user.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Mint the customer session via the BetterAuth plugin.
    let sessionHeaders: Headers;
    try {
      const session = await createCustomerSession(user.id, ctx.req);
      sessionHeaders = session.headers;
    } catch (err) {
      log.error("createCustomerSession failed", {
        userId: user.id,
        error: err instanceof Error ? err.message : String(err),
      });
      return jsonResponse(500, { error: "internal" });
    }

    // Audit: register both the device row and the token issuance, the
    // same way /api/devices/register does — so the audit trail across
    // the two paths is consistent and ops can grep for them uniformly.
    void logDeviceRegistered({
      userId: user.id,
      ip,
      ua: ctx.req.headers.get("user-agent"),
      route: ROUTE,
      metadata: {
        deviceId: inserted.id,
        kind: inserted.kind,
        platform: inserted.platform,
        model: inserted.model,
        appVersion: inserted.appVersion,
        capabilities: inserted.capabilities,
        flow: "qr-sign-in",
      },
    });
    void logDeviceTokenIssued({
      userId: user.id,
      ip,
      ua: ctx.req.headers.get("user-agent"),
      route: ROUTE,
      metadata: {
        deviceId: inserted.id,
        tokenId: tokenRow.id,
        hashPrefix: creds.deviceTokenHash.slice(0, 8),
        flow: "qr-sign-in",
      },
    });

    // Response shape mirrors /api/devices/register so the iOS app can
    // share the persistence path between admin-flow and customer-flow
    // registrations.
    return jsonResponse(
      200,
      {
        device: {
          id: inserted.id,
          label: inserted.label,
          capabilities: inserted.capabilities,
          ownerUserId: inserted.ownerUserId,
        },
        token: {
          id: tokenRow.id,
          deviceToken: creds.deviceToken,
          deviceSecret: creds.deviceSecret,
          expiresAt: expiresAt.toISOString(),
        },
        user: {
          id: user.id,
          publicId: user.publicId,
          name: user.name,
          email: user.email,
        },
      },
      sessionHeaders,
    );
  },
});

/**
 * POST /api/auth/magic-link/verify — iOS magic-email-link sign-in entry.
 *
 * Sister surface to `/api/auth/qr-sign-in`. Where QR sign-in trades a
 * publicId for a session, this route trades a Better-Auth magic-link
 * token (delivered via email) for the same outputs:
 *
 *   1. Customer session cookies (Set-Cookie set by Better-Auth's
 *      `magicLinkVerify`, forwarded as-is on our response).
 *   2. A freshly-registered `devices` row with `kind: "phone_nfc"` and
 *      `capabilities: ["user"]` (centralised via
 *      `customerCapabilityDefaults` — never extended in customer flows).
 *   3. A `device_tokens` row + the cleartext `(deviceToken, deviceSecret)`
 *      pair the iOS app stores in Keychain.
 *
 * Flow:
 *   1. iOS receives a Universal Link to `example.com/auth/verify?token=...`
 *      and instead POSTs the token here together with the device-registration
 *      metadata (label / platform / model / etc.).
 *   2. We invoke Better-Auth's internal `magicLinkVerify` endpoint with
 *      `asResponse:true` so we can fish out Set-Cookie + the JSON body that
 *      contains the user id.
 *   3. On success we register the device + token rows mirroring qr-sign-in.ts,
 *      attach the BA Set-Cookie headers, and respond with the same envelope
 *      so the iOS app shares one persistence path across customer flows.
 *
 * Surface: customer host only (mirrors qr-sign-in.ts). Admin host 404s.
 *
 * Token semantics:
 *   - The token is single-use; Better-Auth deletes the verification row on
 *     success. A failed verification (invalid / expired / attempts-exceeded)
 *     causes magicLinkVerify to redirect — we map the redirect status to a
 *     401/410 and surface an error code the iOS app can show.
 */

import { z } from "zod";
import { eq } from "drizzle-orm";
import { define } from "../../../../utils.ts";
import { db } from "../../../../src/db/index.ts";
import {
  type Device,
  devices,
  type DeviceToken,
  deviceTokens,
  users,
} from "../../../../src/db/schema.ts";
import {
  DEVICE_TOKEN_TTL_MS,
  generateDeviceCredentials,
} from "../../../../src/lib/devices/registration.ts";
import { ensureDeviceTag } from "../../../../src/lib/customer-meta-tags.ts";
import { auth } from "../../../../src/lib/auth.ts";
import { customerCapabilityDefaults } from "../../../../src/lib/auth/customer-capabilities.ts";
import { checkRateLimit } from "../../../../src/lib/utils/rate-limit.ts";
import {
  logDeviceRegistered,
  logDeviceTokenIssued,
  logMagicLinkConsumed,
} from "../../../../src/lib/audit.ts";
import { logger } from "../../../../src/lib/utils/logger.ts";

const log = logger.child("MagicLinkVerify");

const ROUTE = "/api/auth/magic-link/verify";

const PLATFORMS = ["ios", "macos", "ipados"] as const;
const APNS_ENVIRONMENTS = ["sandbox", "production"] as const;

const bodySchema = z.object({
  token: z.string().min(1).max(512),
  deviceLabel: z.string().min(1).max(120),
  platform: z.enum(PLATFORMS),
  model: z.string().min(1).max(80),
  osVersion: z.string().min(1).max(40),
  appVersion: z.string().min(1).max(40),
  pushToken: z.string().max(512).optional(),
  apnsEnvironment: z.enum(APNS_ENVIRONMENTS),
});

// 5 verifications per (token-prefix, IP) per minute. The token itself is
// single-use, so the rate limit mostly bounds enumeration / brute-force on
// the token namespace from a single client. We key on a prefix of the
// supplied token so a malformed token can't pivot the limit window.
const RATE_LIMIT_PER_TOKEN_IP = 5;

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

interface VerifyOutcome {
  ok: boolean;
  status: number;
  errorCode?: string;
  setCookieHeaders?: Headers;
  userId?: string;
  email?: string;
}

/**
 * Invoke Better-Auth's internal `/magic-link/verify` endpoint.
 *
 * We deliberately call WITHOUT a `callbackURL`, which causes magicLinkVerify
 * to return a JSON body of the shape `{ token, user, session }` instead of
 * throwing a redirect. On any failure the endpoint throws an APIError /
 * redirect — we catch and translate to a structured outcome the caller can
 * map to a clean iOS-facing error.
 */
async function consumeMagicLinkToken(
  token: string,
  reqHeaders: Headers,
): Promise<VerifyOutcome> {
  // deno-lint-ignore no-explicit-any
  const api = auth.api as any;
  if (typeof api?.magicLinkVerify !== "function") {
    log.error("magicLinkVerify endpoint missing from auth.api");
    return { ok: false, status: 500, errorCode: "server_misconfig" };
  }
  let resp: Response | unknown;
  try {
    resp = await api.magicLinkVerify({
      query: { token },
      headers: reqHeaders,
      asResponse: true,
    });
  } catch (err) {
    // Better-Auth throws ctx.redirect(...) for INVALID_TOKEN / EXPIRED_TOKEN
    // / ATTEMPTS_EXCEEDED. The thrown object is either an APIError with a
    // .status or a Response; either way, treat as invalid_or_expired and
    // refuse the sign-in.
    log.warn("magicLinkVerify threw", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, status: 401, errorCode: "invalid_or_expired_token" };
  }
  if (!(resp instanceof Response)) {
    log.error("magicLinkVerify returned non-Response", {
      typeofResp: typeof resp,
    });
    return { ok: false, status: 500, errorCode: "server_misconfig" };
  }
  if (resp.status >= 400) {
    return { ok: false, status: 401, errorCode: "invalid_or_expired_token" };
  }
  // 3xx redirects mean the upstream picked a callbackURL path — shouldn't
  // happen because we don't pass one, but treat defensively.
  if (resp.status >= 300 && resp.status < 400) {
    log.warn("magicLinkVerify returned unexpected redirect", {
      status: resp.status,
    });
    return { ok: false, status: 401, errorCode: "invalid_or_expired_token" };
  }
  let body: unknown;
  try {
    body = await resp.clone().json();
  } catch (err) {
    log.error("magicLinkVerify response was not JSON", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, status: 500, errorCode: "internal" };
  }
  const userObj = (body as { user?: { id?: unknown; email?: unknown } })?.user;
  const userId = typeof userObj?.id === "string" ? userObj.id : undefined;
  const email = typeof userObj?.email === "string" ? userObj.email : undefined;
  if (!userId) {
    log.error("magicLinkVerify response missing user.id", {});
    return { ok: false, status: 500, errorCode: "internal" };
  }
  // Forward only the Set-Cookie headers — we don't want to leak Better-Auth's
  // X-Powered-By etc. into our response.
  const setCookieHeaders = new Headers();
  for (const [k, v] of resp.headers.entries()) {
    if (k.toLowerCase() === "set-cookie") {
      setCookieHeaders.append("Set-Cookie", v);
    }
  }
  return {
    ok: true,
    status: 200,
    setCookieHeaders,
    userId,
    email,
  };
}

export const handler = define.handlers({
  async POST(ctx) {
    // Customer-host only. Mirrors qr-sign-in.ts: minting customer sessions
    // on the admin host would let an admin-host browser receive the customer
    // cookie, which is a defense-in-depth no-go.
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
    // Bound enumeration per (token-prefix, IP). The token itself is
    // single-use; this limit protects the verification table from random
    // probing.
    const tokenKeyPart = body.token.slice(0, 16);
    const rateLimitKey = `mlverify:${tokenKeyPart}:${ip}`;
    if (!await checkRateLimit(rateLimitKey, RATE_LIMIT_PER_TOKEN_IP)) {
      return jsonResponse(429, { error: "rate_limited" });
    }

    const outcome = await consumeMagicLinkToken(body.token, ctx.req.headers);
    if (!outcome.ok) {
      return jsonResponse(outcome.status, {
        error: outcome.errorCode ?? "invalid_or_expired_token",
      });
    }

    // Re-fetch the user from our `users` table — Better-Auth's internal
    // user record doesn't carry our Polaris-specific columns (`role`,
    // `publicId`). We treat any non-customer role as a hard 403 to
    // satisfy the same guard polarisCustomerSessionPlugin enforces.
    const [user] = await db
      .select({
        id: users.id,
        publicId: users.publicId,
        name: users.name,
        email: users.email,
        role: users.role,
      })
      .from(users)
      .where(eq(users.id, outcome.userId!))
      .limit(1);
    if (!user) {
      log.error("verified user missing from polaris users table", {
        userId: outcome.userId,
      });
      return jsonResponse(500, { error: "internal" });
    }
    if (user.role !== "customer") {
      log.warn("magic-link verify refused — role is not customer", {
        userId: user.id,
        role: user.role,
      });
      return jsonResponse(403, { error: "not_a_customer" });
    }

    // Best-effort audit of the consume event, mirroring routes/auth/verify.tsx.
    void logMagicLinkConsumed({
      userId: user.id,
      ip,
      ua: ctx.req.headers.get("user-agent"),
      route: ROUTE,
      metadata: { source: "ios_post_verify" },
    });

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
          // Customer-flow device registration always assigns the `user`
          // capability only — see `customerCapabilityDefaults` for the
          // rationale. Admins keep the full picker via /api/devices/register.
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

    // device_tokens row carries the credentials the iOS app stores in Keychain.
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

    // Auto-mint per-device OCPP tag so iOS Mobile Start has a tag to submit
    // without requiring a picker. Best-effort — a StEvE outage shouldn't
    // block sign-in.
    try {
      await ensureDeviceTag(
        inserted.id,
        user.id,
        user.publicId,
        body.deviceLabel,
      );
    } catch (err) {
      log.warn("ensureDeviceTag failed during magic-link verify", {
        deviceId: inserted.id,
        userId: user.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Audit registration + token issuance, same shape as qr-sign-in.ts so
    // the audit trail is consistent across customer login surfaces.
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
        flow: "magic-link-verify",
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
        flow: "magic-link-verify",
      },
    });

    // Response shape matches qr-sign-in.ts so the iOS app can share the
    // persistence path across customer login flows. Set-Cookie headers come
    // straight from Better-Auth's magicLinkVerify response so the cookie is
    // signed with the canonical secret (we don't re-mint via
    // createCustomerSession — magicLinkVerify already did the work).
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
      outcome.setCookieHeaders,
    );
  },
});

/**
 * ExpresScan / Wave 2 Track C-apns — Apple Push Notification client.
 *
 * Pure-library module: no route handlers here. The arm endpoint
 * (Wave 3 / C-scan-arm) imports `sendApns` and fires it no-await alongside the
 * SSE publish, so a phone in the background still wakes up.
 *
 * Three pieces:
 *   1. `signApnsJwt()` — ES256 JWT signer (kid + iss + iat) cached in-process
 *      for ~50 minutes. Apple requires <60min freshness; the conservative cap
 *      avoids races where a long-running request could send an expired token.
 *   2. `sendApns()` — HTTP/2-on-the-wire client to api.push.apple.com (or the
 *      sandbox host) using Deno's `fetch`. Deno negotiates ALPN, so HTTP/2 is
 *      transparent; we only have to set the right headers + body.
 *   3. Canonical payload shape — see `expresscan/docs/plan/20-contracts.md`
 *      § "APNs payload (canonical)". The `aps` dictionary is exactly what the
 *      iOS app's Notification Service Extension expects; custom fields go at
 *      the top level (NOT inside `aps`) so iOS picks them up via the userInfo
 *      `[String: Any]` dictionary on the standard path.
 *
 * Security context (see `expresscan/docs/plan/60-security.md` §7):
 *   - The push payload contains `pairingCode` which is single-use, 90s-TTL'd,
 *     and useless without bearer + secret. Treated as a target identifier,
 *     not a secret.
 *   - The APNs JWT is signed locally with the P8 key. The key never leaves
 *     this process; only the signed JWT goes on the wire.
 *   - The push token is opaque on our side — a leaked DB dump leaks
 *     push-target identity but cannot push without the P8 key.
 */

import { config } from "./config.ts";
import { logger } from "./utils/logger.ts";

const log = logger.child("APNs");

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Logical APNs payload — what callers describe; the library renders it into
 * the canonical wire shape (the `aps` dictionary plus custom top-level keys).
 */
export interface ApnsPayload {
  /** Bundle ID (apns-topic header) — defaults to `config.APNS_TOPIC`. */
  topic?: string;
  /** Visible alert with title + body. */
  alert: { title: string; body: string };
  /** Per-device thread-id; multiple notifications group cleanly. */
  threadId?: string;
  /** Set to "scan-{pairingCode}" to coalesce/replace prior banners. */
  collapseId?: string;
  /** Unix seconds when delivery becomes pointless; APNs drops afterward. */
  expirationEpochSec?: number;
  /** "time-sensitive" bypasses Focus modes; use for scan requests. */
  interruptionLevel?: "passive" | "active" | "time-sensitive" | "critical";
  /** Custom payload fields merged at the top level (NOT inside `aps`). */
  custom?: Record<string, unknown>;
}

/** Where to deliver the push — token + which APNs host to dial. */
export interface ApnsTarget {
  /** Hex push token (from APNs registration on device). */
  pushToken: string;
  environment: "sandbox" | "production";
}

/**
 * Outcome of a single push send. APNs returns 200 on accept; non-200 includes
 * a `reason` string in the JSON body (e.g. `BadDeviceToken`, `Unregistered`).
 * Callers (the scan-arm route) log/meter on `ok=false` but never block the
 * request on it — the SSE publish + DB row are the source of truth.
 */
export type ApnsResult =
  | { ok: true }
  | { ok: false; status: number; reason: string };

/**
 * Send a single push to APNs.
 *
 * Fire-and-forget from the caller's perspective: this resolves to an
 * `ApnsResult` which the caller may log/meter, but does not throw. The arm
 * handler should `void sendApns(...)` so a slow APNs host doesn't gate the
 * arm response.
 */
export async function sendApns(
  target: ApnsTarget,
  payload: ApnsPayload,
): Promise<ApnsResult> {
  const host = target.environment === "production"
    ? "api.push.apple.com"
    : "api.sandbox.push.apple.com";
  const url = `https://${host}/3/device/${target.pushToken}`;

  // Synthesize headers per `20-contracts.md`. apns-expiration defaults to 0
  // ("deliver once or drop") when the caller didn't provide a TTL. Topic
  // resolves at call-time from env (test override) before the boot-time
  // config snapshot — matches the `getApnsJwt` runtime-read pattern.
  const topic = payload.topic ?? Deno.env.get("APNS_TOPIC") ??
    config.APNS_TOPIC;
  const headers: Record<string, string> = {
    "apns-topic": topic,
    "apns-priority": "10",
    "apns-push-type": "alert",
    "apns-expiration": payload.expirationEpochSec !== undefined
      ? String(payload.expirationEpochSec)
      : "0",
    "content-type": "application/json",
  };
  if (payload.collapseId) {
    headers["apns-collapse-id"] = payload.collapseId;
  }

  let jwt: string;
  try {
    jwt = await getApnsJwt();
  } catch (err) {
    log.error("JWT signing failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, status: 0, reason: "JwtSignFailed" };
  }
  headers.authorization = `bearer ${jwt}`;

  const body = renderApnsBody(payload);

  let res: Response;
  try {
    res = await globalThis.fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (err) {
    log.warn("APNs network error", {
      host,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, status: 0, reason: "NetworkError" };
  }

  if (res.status === 200) {
    // APNs returns no body on success; consume so the connection can recycle.
    try {
      await res.body?.cancel();
    } catch { /* ignore */ }
    return { ok: true };
  }

  // Non-200: APNs returns `{"reason":"..."}` JSON. Pull the reason if we can,
  // otherwise fall back to the HTTP status.
  let reason = `HTTP_${res.status}`;
  try {
    const txt = await res.text();
    if (txt) {
      const parsed = JSON.parse(txt) as { reason?: unknown };
      if (typeof parsed.reason === "string" && parsed.reason.length > 0) {
        reason = parsed.reason;
      }
    }
  } catch { /* keep HTTP_x fallback */ }

  log.warn("APNs send rejected", {
    host,
    status: res.status,
    reason,
  });
  return { ok: false, status: res.status, reason };
}

// ---------------------------------------------------------------------------
// Body rendering
// ---------------------------------------------------------------------------

/**
 * Render the canonical APNs body. Splits caller's logical payload into the
 * `aps` dictionary (Apple-defined keys) and custom top-level keys (everything
 * the iOS app needs from `userInfo`).
 *
 * Exported for tests; not part of the public API surface.
 */
export function renderApnsBody(
  payload: ApnsPayload,
): Record<string, unknown> {
  const aps: Record<string, unknown> = {
    alert: { title: payload.alert.title, body: payload.alert.body },
    sound: "default",
    category: "NFC_SCAN_REQUEST",
    "mutable-content": 1,
  };
  if (payload.threadId) aps["thread-id"] = payload.threadId;
  if (payload.interruptionLevel) {
    aps["interruption-level"] = payload.interruptionLevel;
  }

  const body: Record<string, unknown> = {
    aps,
    v: 1,
    ...(payload.custom ?? {}),
  };
  return body;
}

// ---------------------------------------------------------------------------
// JWT signing (ES256)
// ---------------------------------------------------------------------------

/**
 * Cached signed JWT. Apple requires <60min token freshness; we cap at 50min
 * so a request started near the boundary doesn't ride a token Apple is about
 * to reject as too old.
 *
 * In-process cache only — restart resets it. The signer is cheap (single
 * SHA-256 + ECDSA-sign), so we don't bother persisting.
 */
const JWT_TTL_MS = 50 * 60 * 1000;
let cachedJwt: { token: string; expiresAt: number } | null = null;
/** Cached imported CryptoKey (P8 → ECDSA private key). */
let cachedKey: { key: CryptoKey; sourceB64: string } | null = null;

/**
 * Reset the JWT + key cache. Test-only helper; calling at runtime forces
 * re-signing on the next push send.
 */
export function _resetApnsJwtCache(): void {
  cachedJwt = null;
  cachedKey = null;
}

/**
 * Get a signed APNs JWT, reusing the cached value if it's still within the
 * 50-min freshness window.
 *
 * Reads `APNS_KEY_ID` / `APNS_TEAM_ID` / `APNS_KEY_BASE64` at call-time via
 * `Deno.env.get`, falling back to the boot-time `config` snapshot when the
 * env vars aren't set. The runtime read is what makes the cache test
 * possible — and matches the existing `STEVE_PREAUTH_HMAC_KEY` pattern of
 * "boot doesn't fail loud, the request does."
 */
export async function getApnsJwt(now: number = Date.now()): Promise<string> {
  if (cachedJwt && cachedJwt.expiresAt > now) {
    return cachedJwt.token;
  }
  const keyId = Deno.env.get("APNS_KEY_ID") || config.APNS_KEY_ID;
  const teamId = Deno.env.get("APNS_TEAM_ID") || config.APNS_TEAM_ID;
  const keyBase64 = Deno.env.get("APNS_KEY_BASE64") || config.APNS_KEY_BASE64;
  const token = await signApnsJwt({
    keyId,
    teamId,
    keyBase64,
    iatSec: Math.floor(now / 1000),
  });
  cachedJwt = { token, expiresAt: now + JWT_TTL_MS };
  return token;
}

/**
 * Inputs to `signApnsJwt` — broken out so tests can pass deterministic values.
 */
export interface SignApnsJwtInputs {
  keyId: string;
  teamId: string;
  /** Base64-encoded P8 (PKCS8 PEM) blob. Newlines + headers preserved. */
  keyBase64: string;
  /** `iat` claim in unix seconds. Pass a fixed value in tests. */
  iatSec: number;
}

/**
 * Sign an APNs JWT (ES256). Header is `{alg:"ES256",kid:<keyId>,typ:"JWT"}`;
 * claims are `{iss:<teamId>,iat:<iatSec>}`. The ECDSA signature is
 * non-deterministic (random `k`); tests verify with the public key, never
 * by string-matching the third segment.
 */
export async function signApnsJwt(inputs: SignApnsJwtInputs): Promise<string> {
  if (!inputs.keyId) throw new Error("APNS_KEY_ID is empty");
  if (!inputs.teamId) throw new Error("APNS_TEAM_ID is empty");
  if (!inputs.keyBase64) throw new Error("APNS_KEY_BASE64 is empty");

  const key = await loadEcdsaP256Key(inputs.keyBase64);

  const header = { alg: "ES256", kid: inputs.keyId, typ: "JWT" };
  const claims = { iss: inputs.teamId, iat: inputs.iatSec };

  const headerB64 = base64UrlEncodeUtf8(JSON.stringify(header));
  const claimsB64 = base64UrlEncodeUtf8(JSON.stringify(claims));
  const signingInput = `${headerB64}.${claimsB64}`;

  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(signingInput),
  );
  // Web Crypto returns the raw 64-byte (r||s) form, which is exactly what
  // JWS ES256 wants. (PKCS8 PEM keys have a different encoding, but
  // crypto.subtle.sign output is always raw r||s for ECDSA.)
  const sigB64 = base64UrlEncodeBytes(new Uint8Array(sig));
  return `${signingInput}.${sigB64}`;
}

/**
 * Import a P8 private key (PKCS8 PEM, base64-encoded as a single env-var
 * blob) into a Web-Crypto ECDSA P-256 CryptoKey. Cached against the source
 * base64 so identical values reuse the same key.
 */
async function loadEcdsaP256Key(keyBase64: string): Promise<CryptoKey> {
  if (cachedKey && cachedKey.sourceB64 === keyBase64) {
    return cachedKey.key;
  }
  const pem = atob(keyBase64);
  const der = pemToPkcs8Der(pem);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  cachedKey = { key, sourceB64: keyBase64 };
  return key;
}

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

function pemToPkcs8Der(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  if (!body) throw new Error("APNS_KEY_BASE64 contains no PEM body");
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function base64UrlEncodeUtf8(s: string): string {
  return base64UrlEncodeBytes(new TextEncoder().encode(s));
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = btoa(bin);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

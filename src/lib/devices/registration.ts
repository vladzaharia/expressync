/**
 * ExpresScan / Wave 2 Track B-lifecycle — device registration helpers.
 *
 * Centralizes the cryptographic + DB primitives that
 * `routes/api/devices/register.ts` and `routes/admin/expresscan/register.tsx`
 * share:
 *
 *   - `mintOneTimeCode`     — write a `verifications` row keyed on
 *                             `expresscan-register:{userId}:{hashedCode}`,
 *                             store the PKCE `codeChallenge`, return the raw
 *                             one-time code (only ever leaves on the redirect
 *                             URL to the iOS app).
 *
 *   - `claimOneTimeCode`    — atomic UPDATE that marks the row 'consumed' iff
 *                             the supplied PKCE `codeVerifier` hashes to the
 *                             stored challenge. Returns the captured registration
 *                             payload on success, or `null` for any failure
 *                             (mismatch, expired, replay, missing).
 *
 *   - `generateDeviceCredentials` — mint the bearer + secret pair, returning
 *                             both raw values (for the response body) and the
 *                             sha256 hashes (for `device_tokens` row).
 *
 * Security notes:
 *   - One-time code is hashed at rest (`expresscan-register:{userId}:{sha256(rawCode)}`)
 *     so a DB dump never exposes a usable code.
 *   - Atomic single-use is enforced by the `WHERE status='armed'` clause on
 *     UPDATE — concurrent claimers race on the row's status flip and the loser
 *     observes zero affected rows (mirrors `scan-login.ts:222`).
 *   - PKCE verify uses the canonical `SHA256(codeVerifier) === codeChallenge`
 *     check; both sides base64url-encode without padding.
 *   - Code TTL is 60s — long enough to survive a slow Universal-Link bounce,
 *     short enough that a stolen code expires before it can be reused.
 *   - The verifier check is constant-time; a length mismatch returns false
 *     before the per-char loop runs.
 */

import { sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { verifications } from "../../db/schema.ts";
import { logger } from "../utils/logger.ts";
import { sha256Hex } from "./bearer-auth.ts";

const log = logger.child("DeviceRegistration");

/** One-time code TTL — see `30-backend.md` § "Registration flow (PKCE)". */
export const ONE_TIME_CODE_TTL_SEC = 60;

/** Default device-token TTL = 365 days (see `60-security.md` §11). */
export const DEVICE_TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Payload stored in `verifications.value` for a registration row. JSON-encoded
 * so the existing TEXT column doesn't need a schema change.
 */
export interface RegistrationCodePayload {
  /** The PKCE code-challenge (base64url, no padding). */
  codeChallenge: string;
  /** Admin user that minted the code (the would-be owner). */
  userId: string;
  /** Free-text label the admin typed on the register page; surfaced to the device. */
  label: string;
  /** Capabilities the admin pre-approved at mint time. */
  requestedCapabilities: string[];
  /** Status — 'armed' until consumed, then 'consumed'. */
  status: "armed" | "consumed";
  /** ISO timestamp the row was minted (for forensic reads). */
  mintedAtIso: string;
}

/** Result of a successful claim — surfaced to the register handler. */
export interface ClaimedCodePayload {
  userId: string;
  label: string;
  requestedCapabilities: string[];
}

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

/** base64url-encode a Uint8Array (no padding). */
export function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** SHA-256 → base64url (no padding). PKCE-style code-challenge encoding. */
export async function sha256Base64Url(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(digest));
}

/** Constant-time string compare — same primitive as `scan-login.ts:96`. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ---------------------------------------------------------------------------
// One-time-code mint + claim
// ---------------------------------------------------------------------------

/** Build the canonical `verifications.identifier` for a registration row. */
function buildIdentifier(userId: string, hashedCode: string): string {
  return `expresscan-register:${userId}:${hashedCode}`;
}

/**
 * Mint a fresh one-time code for the given admin + PKCE challenge.
 *
 * Returns the raw code. The caller is responsible for putting it in the
 * Universal-Link redirect URL — never log it, never persist it elsewhere.
 *
 * The DB row stores `sha256Hex(rawCode)` in the identifier so even a complete
 * `verifications` table dump can't recover the in-flight code.
 */
export async function mintOneTimeCode(
  userId: string,
  codeChallenge: string,
  label: string,
  requestedCapabilities: string[],
): Promise<string> {
  // 32 random bytes → base64url. Same shape as `scan-arm`'s pairing-code.
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const rawCode = base64UrlEncode(bytes);

  const hashedCode = await sha256Hex(rawCode);
  const identifier = buildIdentifier(userId, hashedCode);

  const payload: RegistrationCodePayload = {
    codeChallenge,
    userId,
    label,
    requestedCapabilities,
    status: "armed",
    mintedAtIso: new Date().toISOString(),
  };

  const expiresAt = new Date(Date.now() + ONE_TIME_CODE_TTL_SEC * 1000);

  await db.insert(verifications).values({
    id: crypto.randomUUID(),
    identifier,
    value: JSON.stringify(payload),
    expiresAt,
  });

  return rawCode;
}

/**
 * Atomically claim a one-time code given the raw code + PKCE verifier.
 *
 * Returns the captured registration payload on success. Returns `null` for:
 *   - missing row (already consumed, expired, never existed)
 *   - PKCE verifier mismatch
 *   - row status not 'armed' (replay)
 *
 * The atomic single-use flip is the same pattern as `scan-login.ts:214-228`:
 * `UPDATE … SET status='consumed' WHERE status='armed' RETURNING …`. Two
 * concurrent claims race on the WHERE clause; the loser observes zero rows.
 */
export async function claimOneTimeCode(
  rawCode: string,
  codeVerifier: string,
): Promise<ClaimedCodePayload | null> {
  if (!rawCode || !codeVerifier) return null;

  // Bounded inputs — defense against pathological-length probes.
  if (rawCode.length > 256 || codeVerifier.length > 256) return null;
  if (codeVerifier.length < 43) return null; // PKCE spec floor (43..128)

  let hashedCode: string;
  try {
    hashedCode = await sha256Hex(rawCode);
  } catch (err) {
    log.error("sha256 of one-time code failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  // We need the userId to build the identifier, but the identifier is
  // `userId-namespaced` for forensics. Look up any armed row whose identifier
  // ends with the hashedCode + the row is still live + status is armed.
  // The id-tag prefix `expresscan-register:` plus suffix `:{hashedCode}` is
  // unique even without the userId since `hashedCode` is sha256(32-byte-rand).
  let row: { id: string; identifier: string; value: string } | undefined;
  try {
    const result = await db.execute<
      { id: string; identifier: string; value: string }
    >(sql`
      SELECT id, identifier, value
      FROM verifications
      WHERE identifier LIKE ${`expresscan-register:%:${hashedCode}`}
        AND expires_at > now()
      LIMIT 1
    `);
    const list = Array.isArray(result) ? result : (result as {
      rows?: { id: string; identifier: string; value: string }[];
    })
      .rows ?? [];
    row = list[0];
  } catch (err) {
    log.error("Lookup of one-time code failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
  if (!row) return null;

  // Parse the stored payload — non-JSON / shape mismatch → bail.
  let payload: RegistrationCodePayload;
  try {
    payload = JSON.parse(row.value) as RegistrationCodePayload;
  } catch {
    return null;
  }
  if (
    !payload || typeof payload !== "object" ||
    typeof payload.codeChallenge !== "string" ||
    typeof payload.userId !== "string" ||
    payload.status !== "armed"
  ) {
    return null;
  }

  // PKCE verify: SHA256(codeVerifier) base64url == codeChallenge.
  let actualChallenge: string;
  try {
    actualChallenge = await sha256Base64Url(codeVerifier);
  } catch (err) {
    log.error("PKCE compute failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
  if (!constantTimeEqual(actualChallenge, payload.codeChallenge)) {
    return null;
  }

  // Atomic single-use claim. Concurrent claimers race here; the loser sees
  // zero affected rows and we return null.
  let consumedRows: { id: string }[];
  try {
    const result = await db.execute<{ id: string }>(sql`
      UPDATE verifications
      SET value = jsonb_set(value::jsonb, '{status}', '"consumed"')::text,
          updated_at = now()
      WHERE id = ${row.id}
        AND expires_at > now()
        AND value::jsonb->>'status' = 'armed'
      RETURNING id
    `);
    consumedRows = (Array.isArray(result)
      ? result
      : (result as { rows?: { id: string }[] }).rows ?? []) as {
        id: string;
      }[];
  } catch (err) {
    log.error("Atomic claim of one-time code failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
  if (consumedRows.length !== 1) return null;

  return {
    userId: payload.userId,
    label: payload.label,
    requestedCapabilities: Array.isArray(payload.requestedCapabilities)
      ? payload.requestedCapabilities.slice()
      : [],
  };
}

// ---------------------------------------------------------------------------
// Bearer + secret minting
// ---------------------------------------------------------------------------

/**
 * Both sides of the credential pair.
 *
 * `deviceToken` is the bearer credential — sent in `Authorization` header,
 * stored hashed at rest (verification = re-hash incoming → DB compare).
 *
 * `deviceSecret` is the per-device HMAC key for scan-result nonces. HMAC is
 * symmetric so the server MUST keep the raw value; the iOS app holds the
 * same value in its Keychain. Same threat model as `STEVE_PREAUTH_HMAC_KEY`
 * (server-resident HMAC key); a DB exfil exposes per-device forging
 * capability bounded by per-device + per-rotation scope.
 */
export interface DeviceCredentials {
  /** Wire format: `dev_<32 random bytes base64url>`. */
  deviceToken: string;
  deviceTokenHash: string;
  /** 32 random bytes base64url-encoded — stored RAW in `device_tokens.secret`. */
  deviceSecret: string;
}

/**
 * Generate a fresh `(deviceToken, deviceSecret)` pair.
 *
 * `deviceTokenHash` is what gets persisted; the raw token leaves only on the
 * `POST /api/devices/register` response body. `deviceSecret` is persisted RAW
 * (HMAC requires symmetric key access on both sides).
 */
export async function generateDeviceCredentials(): Promise<DeviceCredentials> {
  const tokenBytes = new Uint8Array(32);
  crypto.getRandomValues(tokenBytes);
  const deviceToken = `dev_${base64UrlEncode(tokenBytes)}`;
  const deviceTokenHash = await sha256Hex(deviceToken);

  const secretBytes = new Uint8Array(32);
  crypto.getRandomValues(secretBytes);
  const deviceSecret = base64UrlEncode(secretBytes);

  return {
    deviceToken,
    deviceTokenHash,
    deviceSecret,
  };
}

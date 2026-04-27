/**
 * ExpresScan / Wave 3 Track C-scan-arm — admin scan-arm endpoint.
 *
 *   POST   /api/admin/devices/{deviceId}/scan-arm  — arm a scan request
 *   DELETE /api/admin/devices/{deviceId}/scan-arm  — release an armed pairing
 *
 * Mirrors `/api/admin/tag/scan-arm` (charger pre-authorize armed pairing) but
 * targets the `devices` table: an admin "asks" a registered iPhone to perform
 * an NFC scan. Two delivery channels for the prompt:
 *
 *   1. SSE — `device.scan.requested` event published to the in-process bus,
 *      consumed by the device's open `/api/devices/scan-stream` connection.
 *   2. APNs push — fire-and-forget alongside the SSE publish so a phone in
 *      the background still wakes up. `sendApns` is awaited inside `void` so
 *      a slow Apple host never gates the response. See `60-security.md` §7.
 *
 * Identifier convention: `device-scan:{deviceId}:{pairingCode}`. The pairing
 * code is 6 uppercase alphanumeric chars, `O0Il1` excluded for legibility on
 * a phone screen. Single-use, 90 s TTL — `verifications.expires_at` is the
 * source of truth for the "still armed" check (mirrors `scan-pair.ts`).
 *
 * Auth model:
 *   - Admin cookie session (middleware-gated). Bearer is rejected upstream.
 *   - Owner check in app code: `ctx.state.user.id === devices.owner_user_id`.
 *     Admin-on-someone-else's-device is deferred to v1.1 — `60-security.md`
 *     §5 stipulates 403 for v1.
 *
 * Pre-flight rejections (POST):
 *   401 unauthorized          — no cookie session
 *   403 forbidden             — logged-in user is not role='admin'
 *   400 invalid_body          — missing/invalid `purpose`
 *   400 capability_missing    — device row lacks `'tap' = ANY(capabilities)`
 *   404 not_found             — no device row with that id
 *   410 device_revoked        — `deleted_at IS NOT NULL` or `revoked_at IS NOT NULL`
 *   403 not_owner             — admin caller is not the device owner
 *   409 device_offline        — `last_seen_at` older than 90 s
 *   409 conflict              — already-armed row exists; body echoes the
 *                               existing `pairingCode` + `expiresInSec` so
 *                               the caller can resume
 *
 * Idempotency: both POST and DELETE wrap in `withIdempotency`. A retry hits
 * the cached row and returns the original status+body without re-firing the
 * push or audit. See `src/lib/idempotency.ts` for the contract.
 */

import { eq, sql } from "drizzle-orm";
import { define } from "../../../../../utils.ts";
import { db } from "../../../../../src/db/index.ts";
import { devices, verifications } from "../../../../../src/db/schema.ts";
import {
  type DeviceScanRequestedPayload,
  SCAN_PURPOSES,
  type ScanPurpose,
} from "../../../../../src/lib/types/devices.ts";
import {
  logDeviceScanArmed,
  logDeviceScanReleased,
} from "../../../../../src/lib/audit.ts";
import { eventBus } from "../../../../../src/services/event-bus.service.ts";
import { withIdempotency } from "../../../../../src/lib/idempotency.ts";
import {
  type ApnsPayload,
  type ApnsResult,
  type ApnsTarget,
  sendApns,
} from "../../../../../src/lib/apns.ts";
import { logger } from "../../../../../src/lib/utils/logger.ts";

const log = logger.child("AdminDeviceScanArm");

const POST_ROUTE = "/api/admin/devices/[deviceId]/scan-arm";
const DELETE_ROUTE = "/api/admin/devices/[deviceId]/scan-arm";

/** Pairing-row TTL — matches `scan-pair.ts` and `20-contracts.md`. */
const PAIRING_TTL_SEC = 90;

/** Online cutoff matches `scan-tap-targets.ts` and `admin/devices/index.ts`. */
const ONLINE_WINDOW_MS = 90 * 1000;

/**
 * Pairing-code charset. 32 chars: 0-9 + A-Z minus the visually-confusable
 * `O 0 I 1 L`. 6 chars over 32 ≈ 30 bits of entropy — single-use + 90 s TTL
 * makes brute-forcing it infeasible against the rate limits.
 */
const PAIRING_CHARS = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const PAIRING_LEN = 6;

const SCAN_PURPOSE_SET: ReadonlySet<string> = new Set(SCAN_PURPOSES);

interface DeviceRow {
  id: string;
  ownerUserId: string;
  capabilities: string[];
  pushToken: string | null;
  apnsEnvironment: string | null;
  lastSeenAt: Date | null;
  deletedAt: Date | null;
  revokedAt: Date | null;
}

// ===========================================================================
// Test seams. Module-level swappable hooks for unit tests that don't have a
// live Postgres. Defaults call the real `db` / `sendApns`. Each setter takes
// `null` to restore the default. Co-located in one block so the production
// code path is obvious and the test surface is auditable.
// ===========================================================================

type ApnsSender = (
  target: ApnsTarget,
  payload: ApnsPayload,
) => Promise<ApnsResult>;

type DeviceLoader = (deviceId: string) => Promise<DeviceRow | null>;
type ArmedPairingFinder = (
  deviceId: string,
) => Promise<{ pairingCode: string; expiresAt: Date } | null>;
type PairingInserter = (row: {
  identifier: string;
  value: string;
  expiresAt: Date;
}) => Promise<void>;
type PairingDeleter = (identifier: string) => Promise<void>;
type PushTokenClearer = (deviceId: string) => Promise<void>;

const defaultDeviceLoader: DeviceLoader = async (deviceId) => {
  const [row] = await db
    .select({
      id: devices.id,
      ownerUserId: devices.ownerUserId,
      capabilities: devices.capabilities,
      pushToken: devices.pushToken,
      apnsEnvironment: devices.apnsEnvironment,
      lastSeenAt: devices.lastSeenAt,
      deletedAt: devices.deletedAt,
      revokedAt: devices.revokedAt,
    })
    .from(devices)
    .where(eq(devices.id, deviceId))
    .limit(1);
  return row ?? null;
};

const defaultArmedPairingFinder: ArmedPairingFinder = async (deviceId) => {
  try {
    const result = await db.execute<
      { identifier: string; expires_at: Date | string }
    >(sql`
      SELECT identifier, expires_at FROM verifications
      WHERE identifier LIKE ${`device-scan:${deviceId}:%`}
        AND expires_at > now()
        AND value::jsonb->>'status' = 'armed'
      ORDER BY expires_at DESC
      LIMIT 1
    `);
    const rows = Array.isArray(result)
      ? result
      : (result as { rows?: unknown[] }).rows ?? [];
    if (rows.length === 0) return null;
    const r = rows[0] as { identifier: string; expires_at: Date | string };
    const prefix = `device-scan:${deviceId}:`;
    if (!r.identifier.startsWith(prefix)) return null;
    const code = r.identifier.slice(prefix.length);
    const expiresAt = r.expires_at instanceof Date
      ? r.expires_at
      : new Date(r.expires_at);
    return { pairingCode: code, expiresAt };
  } catch (err) {
    log.warn("Armed-pairing precheck failed; continuing", {
      deviceId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
};

const defaultPairingInserter: PairingInserter = async (row) => {
  await db.insert(verifications).values({
    id: crypto.randomUUID(),
    identifier: row.identifier,
    value: row.value,
    expiresAt: row.expiresAt,
  });
};

const defaultPairingDeleter: PairingDeleter = async (identifier) => {
  await db.delete(verifications).where(
    eq(verifications.identifier, identifier),
  );
};

const defaultPushTokenClearer: PushTokenClearer = async (deviceId) => {
  await db
    .update(devices)
    .set({ pushToken: null, apnsEnvironment: null })
    .where(eq(devices.id, deviceId));
};

let apnsSender: ApnsSender = sendApns;
let deviceLoader: DeviceLoader = defaultDeviceLoader;
let armedPairingFinder: ArmedPairingFinder = defaultArmedPairingFinder;
let pairingInserter: PairingInserter = defaultPairingInserter;
let pairingDeleter: PairingDeleter = defaultPairingDeleter;
let pushTokenClearer: PushTokenClearer = defaultPushTokenClearer;

/** Test-only — install a fake sender. Pass `null` to restore the real one. */
export function _setApnsSenderForTests(fn: ApnsSender | null): void {
  apnsSender = fn ?? sendApns;
}

/** Test-only — install a fake device loader. Pass `null` to restore default. */
export function _setDeviceLoaderForTests(fn: DeviceLoader | null): void {
  deviceLoader = fn ?? defaultDeviceLoader;
}

/** Test-only — install a fake armed-pairing finder. Pass `null` to restore. */
export function _setArmedPairingFinderForTests(
  fn: ArmedPairingFinder | null,
): void {
  armedPairingFinder = fn ?? defaultArmedPairingFinder;
}

/** Test-only — install a fake pairing-row inserter. Pass `null` to restore. */
export function _setPairingInserterForTests(fn: PairingInserter | null): void {
  pairingInserter = fn ?? defaultPairingInserter;
}

/** Test-only — install a fake pairing-row deleter. Pass `null` to restore. */
export function _setPairingDeleterForTests(fn: PairingDeleter | null): void {
  pairingDeleter = fn ?? defaultPairingDeleter;
}

/** Test-only — install a fake push-token clearer. Pass `null` to restore. */
export function _setPushTokenClearerForTests(
  fn: PushTokenClearer | null,
): void {
  pushTokenClearer = fn ?? defaultPushTokenClearer;
}

/** Test-only — restore every seam in one call. */
export function _resetScanArmTestSeams(): void {
  apnsSender = sendApns;
  deviceLoader = defaultDeviceLoader;
  armedPairingFinder = defaultArmedPairingFinder;
  pairingInserter = defaultPairingInserter;
  pairingDeleter = defaultPairingDeleter;
  pushTokenClearer = defaultPushTokenClearer;
}

// ===========================================================================
// Helpers
// ===========================================================================

function jsonResponse(
  status: number,
  body: unknown,
  extraHeaders?: Record<string, string>,
): Response {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) headers.set(k, v);
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function unauthorized(): Response {
  return jsonResponse(401, { error: "unauthorized" });
}

function forbidden(error = "forbidden"): Response {
  return jsonResponse(403, { error });
}

function badRequest(error: string): Response {
  return jsonResponse(400, { error });
}

function notFound(): Response {
  return jsonResponse(404, { error: "not_found" });
}

function isLikelyUuid(s: string): boolean {
  // Loose check — middleware passes path params through verbatim. We just
  // want to reject obvious garbage before it hits the DB and surface a
  // clean 404 instead of a Postgres "invalid input syntax for type uuid".
  return s.length >= 8 && s.length <= 64;
}

/**
 * Generate a pairing code: 6 chars from the legibility-safe alphabet. Uses
 * `crypto.getRandomValues` for unbiased sampling — modulo on `Math.random`
 * would skew the distribution.
 */
function generatePairingCode(): string {
  const out: string[] = [];
  // Oversample so the rejection-sampling loop below has plenty of bytes to
  // pick from. 256 isn't a multiple of 31, so we discard bytes ≥ N*31 to
  // keep the distribution uniform.
  const charsetLen = PAIRING_CHARS.length;
  const limit = Math.floor(256 / charsetLen) * charsetLen;
  const buf = new Uint8Array(PAIRING_LEN * 4);
  crypto.getRandomValues(buf);
  for (const byte of buf) {
    if (out.length === PAIRING_LEN) break;
    if (byte >= limit) continue;
    out.push(PAIRING_CHARS[byte % charsetLen]);
  }
  // Belt-and-braces top-up in case rejection-sampling rejected too many.
  while (out.length < PAIRING_LEN) {
    const b = new Uint8Array(1);
    crypto.getRandomValues(b);
    if (b[0] >= limit) continue;
    out.push(PAIRING_CHARS[b[0] % charsetLen]);
  }
  return out.join("");
}

function getClientIp(req: Request): string | null {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    req.headers.get("cf-connecting-ip") ??
    null;
}

interface ParsedPostBody {
  purpose: ScanPurpose;
  hintLabel: string | null;
}

/** Parse + validate the POST body. Returns null on validation failure. */
function parsePostBody(raw: unknown): ParsedPostBody | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const purpose = r.purpose;
  if (typeof purpose !== "string" || !SCAN_PURPOSE_SET.has(purpose)) {
    return null;
  }
  let hintLabel: string | null = null;
  if (r.hintLabel !== undefined && r.hintLabel !== null) {
    if (typeof r.hintLabel !== "string") return null;
    const trimmed = r.hintLabel.trim();
    if (trimmed.length === 0) {
      hintLabel = null;
    } else if (trimmed.length > 80) {
      // Truncate (don't reject) — admin UIs may paste long location strings.
      hintLabel = trimmed.slice(0, 80);
    } else {
      hintLabel = trimmed;
    }
  }
  return { purpose: purpose as ScanPurpose, hintLabel };
}

function secondsUntil(d: Date): number {
  const ms = d.getTime() - Date.now();
  return ms <= 0 ? 0 : Math.ceil(ms / 1000);
}

// ===========================================================================
// Handlers
// ===========================================================================

export const handler = define.handlers({
  /**
   * POST — arm a scan. Inserts a `device-scan:{id}:{code}` verification row,
   * publishes `device.scan.requested`, fires APNs no-await, audits.
   */
  async POST(ctx) {
    // Distinguish anon (no session at all → 401) from a logged-in non-admin
    // (cookie session, wrong role → 403). Mirrors `register.ts` so the wire
    // contract is consistent across all admin-gated device endpoints.
    if (!ctx.state.user) return unauthorized();
    if (ctx.state.user.role !== "admin") return forbidden();
    const adminUserId = ctx.state.user.id;

    const deviceId = ctx.params.deviceId;
    if (!deviceId || !isLikelyUuid(deviceId)) return notFound();

    return await withIdempotency(ctx, POST_ROUTE, async () => {
      // ---- body ----
      let parsed: ParsedPostBody | null = null;
      try {
        const text = await ctx.req.text();
        if (text.trim() === "") return badRequest("invalid_body");
        const raw = JSON.parse(text);
        parsed = parsePostBody(raw);
      } catch {
        return badRequest("invalid_body");
      }
      if (!parsed) return badRequest("invalid_body");
      const { purpose, hintLabel } = parsed;

      // ---- device preflight ----
      let device: DeviceRow | null;
      try {
        device = await deviceLoader(deviceId);
      } catch (err) {
        log.error("Failed to load device row", {
          deviceId,
          error: err instanceof Error ? err.message : String(err),
        });
        return jsonResponse(500, { error: "internal_error" });
      }
      if (!device) return notFound();

      if (device.deletedAt !== null || device.revokedAt !== null) {
        return jsonResponse(410, { error: "device_revoked" });
      }
      if (device.ownerUserId !== adminUserId) {
        // v1: cross-admin arm-with-consent is deferred. Plain 403 keeps the
        // attack surface minimal (an admin can't probe another admin's
        // device fleet from this endpoint).
        return forbidden("not_owner");
      }
      if (!device.capabilities.includes("tap")) {
        return badRequest("capability_missing");
      }

      const lastSeenMs = device.lastSeenAt ? device.lastSeenAt.getTime() : null;
      const isOnline = lastSeenMs !== null &&
        (Date.now() - lastSeenMs) <= ONLINE_WINDOW_MS;
      if (!isOnline) {
        return jsonResponse(409, { error: "device_offline" });
      }

      // ---- existing-armed check ----
      const existing = await armedPairingFinder(deviceId);
      if (existing) {
        return jsonResponse(409, {
          error: "conflict",
          pairingCode: existing.pairingCode,
          expiresInSec: secondsUntil(existing.expiresAt),
          purpose, // echo what the caller asked for; prior purpose is opaque
        });
      }

      // ---- INSERT pairing row ----
      const pairingCode = generatePairingCode();
      const identifier = `device-scan:${deviceId}:${pairingCode}`;
      const expiresAt = new Date(Date.now() + PAIRING_TTL_SEC * 1000);
      const value = JSON.stringify({
        deviceId,
        purpose,
        hintLabel,
        status: "armed",
        armedByUserId: adminUserId,
      });

      // No unique constraint on `verifications.identifier` (see
      // `drizzle/0000_*.sql`), so we can't `ON CONFLICT (identifier)` at the
      // SQL level. The pre-check above already rules out armed dupes; an
      // INSERT race is statistically negligible (≈30 bits of entropy in the
      // pairing code) and even if it fired, both rows are valid pairings
      // with different codes — both still resolve to this device.
      try {
        await pairingInserter({ identifier, value, expiresAt });
      } catch (err) {
        // Re-query in case a concurrent arm beat us in the window between
        // the precheck and the insert. Mirror the spec's "0 rows → race
        // fired → return 409 with the existing code".
        log.warn("Pairing INSERT failed; re-checking for armed", {
          deviceId,
          error: err instanceof Error ? err.message : String(err),
        });
        const fallback = await armedPairingFinder(deviceId);
        if (fallback) {
          return jsonResponse(409, {
            error: "conflict",
            pairingCode: fallback.pairingCode,
            expiresInSec: secondsUntil(fallback.expiresAt),
            purpose,
          });
        }
        return jsonResponse(500, { error: "internal_error" });
      }

      // ---- publish event-bus event ----
      const expiresAtIso = expiresAt.toISOString();
      const expiresAtEpochMs = expiresAt.getTime();
      const eventPayload: DeviceScanRequestedPayload = {
        deviceId,
        pairingCode,
        purpose,
        expiresAtIso,
        expiresAtEpochMs,
        requestedByUserId: adminUserId,
        hintLabel,
      };
      try {
        eventBus.publish({
          type: "device.scan.requested",
          payload: eventPayload,
        });
      } catch (err) {
        log.warn("Event-bus publish failed (non-fatal)", {
          deviceId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // ---- fire APNs no-await ----
      // Spec: "If `devices.push_token` is set, fire APNs without await
      // (best-effort)". We capture the promise so test seams can observe it
      // (and so an unhandled rejection doesn't crash the worker), but we
      // never `await` it from the handler's response path.
      if (
        device.pushToken &&
        (device.apnsEnvironment === "sandbox" ||
          device.apnsEnvironment === "production")
      ) {
        const apnsTarget: ApnsTarget = {
          pushToken: device.pushToken,
          environment: device.apnsEnvironment,
        };
        // expirationEpochSec = pairing expiry in unix seconds (apns-expiration
        // header). After that, APNs drops the push — matches the pairing TTL.
        const apnsPayload: ApnsPayload = {
          alert: {
            title: "Scan a card now",
            body: hintLabel
              ? `Tap to start the NFC scan: ${hintLabel}`
              : "Tap to start the NFC scan",
          },
          threadId: `device-scan-${deviceId}`,
          collapseId: `scan-${pairingCode}`,
          interruptionLevel: "time-sensitive",
          expirationEpochSec: Math.floor(expiresAtEpochMs / 1000),
          custom: {
            deviceId,
            pairingCode,
            purpose,
            hintLabel,
            expiresAtEpochMs,
          },
        };
        const sendPromise = apnsSender(apnsTarget, apnsPayload);
        // Attach a logger so a rejected push never bubbles to the runtime.
        sendPromise
          .then(async (result) => {
            if (result.ok) return;
            log.warn("APNs send rejected", {
              deviceId,
              pairingCode,
              status: result.status,
              reason: result.reason,
            });
            // Apple's "this token is dead" responses (HTTP 410 or
            // BadDeviceToken / Unregistered on 400) — clear push_token so we
            // stop probing a stale token on every subsequent arm. The next
            // PUT /api/devices/{id}/push-token call from the iOS app will
            // re-populate it.
            const dead = result.status === 410 ||
              result.reason === "Unregistered" ||
              result.reason === "BadDeviceToken";
            if (!dead) return;
            try {
              await pushTokenClearer(deviceId);
              log.info("APNs token cleared after dead-token response", {
                deviceId,
                reason: result.reason,
              });
            } catch (err) {
              log.warn("APNs dead-token clear failed", {
                deviceId,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          })
          .catch((err) => {
            log.warn("APNs send threw", {
              deviceId,
              error: err instanceof Error ? err.message : String(err),
            });
          });
      }

      // ---- audit (best-effort; never throws) ----
      void logDeviceScanArmed({
        userId: adminUserId,
        ip: getClientIp(ctx.req),
        ua: ctx.req.headers.get("user-agent"),
        route: POST_ROUTE,
        metadata: {
          deviceId,
          pairingCode,
          purpose,
          hintLabel,
          armedByUserId: adminUserId,
        },
      });

      return jsonResponse(200, {
        ok: true,
        pairingCode,
        deviceId,
        expiresInSec: PAIRING_TTL_SEC,
        purpose,
      });
    });
  },

  /**
   * DELETE — release an armed pairing. Idempotent: returns 200 even if the
   * row is already gone. Body: `{ pairingCode: string }`.
   */
  async DELETE(ctx) {
    if (!ctx.state.user) return unauthorized();
    if (ctx.state.user.role !== "admin") return forbidden();
    const adminUserId = ctx.state.user.id;

    const deviceId = ctx.params.deviceId;
    if (!deviceId || !isLikelyUuid(deviceId)) return notFound();

    return await withIdempotency(ctx, DELETE_ROUTE, async () => {
      let pairingCode: string;
      try {
        const text = await ctx.req.text();
        if (text.trim() === "") return badRequest("invalid_body");
        const body = JSON.parse(text) as { pairingCode?: unknown };
        if (typeof body.pairingCode !== "string") {
          return badRequest("invalid_body");
        }
        pairingCode = body.pairingCode.trim();
        if (pairingCode.length === 0 || pairingCode.length > 64) {
          return badRequest("invalid_body");
        }
      } catch {
        return badRequest("invalid_body");
      }

      // Owner check on release: even though the row is keyed by
      // (deviceId, pairingCode), we still want a clean 403 when an admin
      // tries to release a non-owned device's pairing — keeps the audit
      // trail honest.
      let device: DeviceRow | null;
      try {
        device = await deviceLoader(deviceId);
      } catch (err) {
        log.warn("DELETE device load failed; proceeding to delete", {
          deviceId,
          error: err instanceof Error ? err.message : String(err),
        });
        device = null;
      }
      if (device && device.ownerUserId !== adminUserId) {
        return forbidden("not_owner");
      }

      const identifier = `device-scan:${deviceId}:${pairingCode}`;
      try {
        await pairingDeleter(identifier);
      } catch (err) {
        log.warn("Failed to release pairing (idempotent — ignoring)", {
          deviceId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // Notify both the in-flight admin SSE consumer (so the
      // TapToAddModal closes) and the device's SSE stream (so the
      // active-scan screen dismisses on the iPhone). Source `"admin"`
      // disambiguates from device-initiated cancels in the audit
      // trail.
      try {
        eventBus.publish({
          type: "device.scan.cancelled",
          payload: {
            deviceId,
            pairingCode,
            cancelledAt: Date.now(),
            source: "admin",
          },
        });
      } catch (err) {
        log.warn("Event-bus publish failed (non-fatal)", {
          deviceId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      void logDeviceScanReleased({
        userId: adminUserId,
        ip: getClientIp(ctx.req),
        ua: ctx.req.headers.get("user-agent"),
        route: DELETE_ROUTE,
        metadata: {
          deviceId,
          pairingCode,
          armedByUserId: adminUserId,
        },
      });

      return jsonResponse(200, { ok: true });
    });
  },
});

// Suppress unused-import warning if a future refactor drops the helper.
void sql;

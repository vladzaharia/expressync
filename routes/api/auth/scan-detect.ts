/**
 * GET /api/auth/scan-detect?pairingCode=…&chargeBoxId=…  (charger flow)
 * GET /api/auth/scan-detect?pairingCode=…&deviceId=…     (device flow)
 *
 * Polaris Track C — public SSE endpoint that streams matching tag-scan
 * events for a previously armed pairing.
 *
 * Two pairable types share one handler. The query param decides which
 * branch:
 *   - chargeBoxId: existing customer scan-to-login flow. Verification
 *     identifier is `scan-pair:{chargeBoxId}:{pairingCode}`. Filters
 *     `scan.intercepted` by `(pairableType="charger", pairableId,
 *     pairingCode)`.
 *   - deviceId: new ExpresScan flow. The browser-side scan-modal UI
 *     opens this stream after `POST /api/admin/devices/{deviceId}/scan-arm`
 *     publishes `device.scan.requested`. Verification identifier is
 *     `device-scan:{deviceId}:{pairingCode}`. Filters `scan.intercepted`
 *     by `(pairableType="device", pairableId, pairingCode)`.
 *
 * Per-event payload (charger flow):
 *   data: { idTag, nonce, t }
 *   nonce = HMAC-SHA256(AUTH_SECRET,
 *     `${idTag}:${pairingCode}:${chargeBoxId}:${t}`)
 *
 * Per-event payload (device flow):
 *   data: { idTag, nonce, t }
 *   nonce = HMAC-SHA256(AUTH_SECRET,
 *     `${idTag}:${pairingCode}:${deviceId}:${t}`)
 *
 * The HMAC binding key is the same `AUTH_SECRET` and the nonce shape is
 * identical — the third positional segment (chargeBoxId vs deviceId) is
 * the only difference, mirroring the way scan-login.ts already verifies
 * the binding when the customer surface POSTs the pairing-complete call.
 *
 * Concurrency:
 *   - Per-IP cap: 3 simultaneous connections (in-process Map). When the
 *     cap is hit, the 4th returns 429.
 *   - Server-side timeout: 60s with no consumer activity → close.
 *   - Keep-alive heartbeat every 15s.
 *
 * Note: the docker-log-subscriber path is **charger-only** — it parses
 * StEvE OCPP log lines, which only exist for charger pairings. The
 * device-scan path doesn't subscribe to the docker log; the
 * `scan.intercepted` event-bus path covers it via
 * `pairableType: "device"`, source `device-scan-result`.
 */

import { sql } from "drizzle-orm";
import { define } from "../../../utils.ts";
import { db } from "../../../src/db/index.ts";
import { config } from "../../../src/lib/config.ts";
import { subscribe } from "../../../src/services/docker-log-subscriber.ts";
import { eventBus } from "../../../src/services/event-bus.service.ts";
import { logger } from "../../../src/lib/utils/logger.ts";

const log = logger.child("ScanDetect");

const TIMEOUT_MS = 60_000;
const KEEPALIVE_MS = 15_000;
const MAX_CONCURRENT_PER_IP = 3;

// In-process counter for per-IP concurrent connections. Resets on
// process restart — that's acceptable: the limit is a DoS speed-bump
// for slow attackers, not a hard authorization gate.
const concurrentByIp = new Map<string, number>();

function getClientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    req.headers.get("cf-connecting-ip") ??
    "unknown";
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const _enc = new TextEncoder();
function hexEncode(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < view.length; i++) {
    s += view[i].toString(16).padStart(2, "0");
  }
  return s;
}

let cachedHmacKey: CryptoKey | null = null;
async function getHmacKey(): Promise<CryptoKey> {
  if (cachedHmacKey) return cachedHmacKey;
  cachedHmacKey = await crypto.subtle.importKey(
    "raw",
    _enc.encode(config.AUTH_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return cachedHmacKey;
}

/** Compute HMAC-SHA256 over `${idTag}:${pairingCode}:${pairableId}:${t}`. */
async function signNonce(
  idTag: string,
  pairingCode: string,
  pairableId: string,
  t: number,
): Promise<string> {
  const key = await getHmacKey();
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    _enc.encode(`${idTag}:${pairingCode}:${pairableId}:${t}`),
  );
  return hexEncode(sig);
}

type PairableType = "charger" | "device";

interface PairableBinding {
  pairableType: PairableType;
  pairableId: string;
  pairingCode: string;
  /** verifications.identifier for the armed-row lookup. */
  identifier: string;
}

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const pairingCode = url.searchParams.get("pairingCode") ?? "";
    const chargeBoxId = url.searchParams.get("chargeBoxId") ?? "";
    const deviceId = url.searchParams.get("deviceId") ?? "";
    if (!pairingCode || (!chargeBoxId && !deviceId)) {
      return jsonResponse(400, {
        error: "pairingCode_and_(chargeBoxId|deviceId)_required",
      });
    }
    if (chargeBoxId && deviceId) {
      // Pick one — both set is almost certainly a UI bug.
      return jsonResponse(400, {
        error: "chargeBoxId_and_deviceId_are_mutually_exclusive",
      });
    }

    const binding: PairableBinding = chargeBoxId
      ? {
        pairableType: "charger",
        pairableId: chargeBoxId,
        pairingCode,
        identifier: `scan-pair:${chargeBoxId}:${pairingCode}`,
      }
      : {
        pairableType: "device",
        pairableId: deviceId,
        pairingCode,
        identifier: `device-scan:${deviceId}:${pairingCode}`,
      };

    const ip = getClientIp(ctx.req);
    const cur = concurrentByIp.get(ip) ?? 0;
    if (cur >= MAX_CONCURRENT_PER_IP) {
      return jsonResponse(429, { error: "too_many_concurrent_streams" });
    }

    // Verify the pairing is armed and not expired. Also pull
    // `expires_at` so the connected event can broadcast the canonical
    // server-stamped expiry; the iOS app's SSE stream and the admin
    // browser both drive their countdowns from this single source so
    // the two never disagree (was the cause of the 20 s vs 90 s desync
    // before this change).
    let armedExpiresAt: Date | null = null;
    try {
      const result = await db.execute<{ id: string; expires_at: string }>(sql`
        SELECT id, expires_at FROM verifications
        WHERE identifier = ${binding.identifier}
          AND expires_at > now()
          AND value::jsonb->>'status' = 'armed'
        LIMIT 1
      `);
      const list = Array.isArray(result)
        ? result
        : (result as { rows?: { id: string; expires_at: string }[] }).rows ??
          [];
      const row = list[0] as { expires_at?: string } | undefined;
      if (row?.expires_at) {
        armedExpiresAt = new Date(row.expires_at);
      }
    } catch (err) {
      log.error("Failed pairing lookup", {
        pairableType: binding.pairableType,
        error: err instanceof Error ? err.message : String(err),
      });
      return jsonResponse(500, { error: "internal" });
    }
    if (!armedExpiresAt) {
      // Generic 404 — never tell the caller WHY (expired vs unknown vs
      // consumed) so they can't enumerate codes.
      return jsonResponse(404, { error: "pairing_not_found" });
    }
    // Snapshot at SSE-open time. The verification row's TTL is a
    // server-stamped absolute, so re-reads aren't needed; an
    // admin-cancel between this point and the connected-event flush
    // produces a `device.scan.cancelled` event, which the live
    // subscription below will translate into a `cancelled` SSE event
    // on this very stream.
    const expiresAtEpochMs = armedExpiresAt.getTime();
    const expiresInSec = Math.max(
      0,
      Math.ceil((expiresAtEpochMs - Date.now()) / 1000),
    );

    // Reserve a slot for this IP. Released in the cleanup path below.
    concurrentByIp.set(ip, cur + 1);

    let unsubscribe: (() => void) | null = null;
    let unsubBus: (() => void) | null = null;
    let keepaliveInterval: ReturnType<typeof setInterval> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    let ctlRef: ReadableStreamDefaultController<Uint8Array> | null = null;

    const safeEnqueue = (chunk: Uint8Array): void => {
      if (closed || !ctlRef) return;
      try {
        ctlRef.enqueue(chunk);
      } catch {
        closed = true;
      }
    };

    const cleanup = (): void => {
      if (closed) return;
      closed = true;
      if (keepaliveInterval) clearInterval(keepaliveInterval);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (unsubscribe) unsubscribe();
      if (unsubBus) unsubBus();
      const remaining = (concurrentByIp.get(ip) ?? 1) - 1;
      if (remaining <= 0) {
        concurrentByIp.delete(ip);
      } else {
        concurrentByIp.set(ip, remaining);
      }
      try {
        ctlRef?.close();
      } catch { /* already closed */ }
    };

    const stream = new ReadableStream<Uint8Array>({
      start: async (controller) => {
        ctlRef = controller;
        // Connected event so the client knows the stream is live. The
        // payload includes `pairableType` so the browser-side handler
        // doesn't need to remember which query param it sent.
        safeEnqueue(
          _enc.encode(
            `event: connected\ndata: ${
              JSON.stringify({
                pairableType: binding.pairableType,
                pairableId: binding.pairableId,
                // Canonical server-stamped expiry; the browser computes
                // its countdown ring from this so it agrees with the
                // iOS active-scan screen down to the second.
                expiresAtEpochMs,
                // Convenience derivation; clients without clock-sync
                // worries can prefer this. Note this is the
                // VERIFICATION row's TTL (90 s typical) — NOT this SSE
                // stream's hard cap (`TIMEOUT_MS`, 60 s), which is
                // about slow-loris guarding, not the pairing.
                expiresInSec,
                // Legacy field for backwards compat with the existing
                // customer login flow (`CustomerScanLoginIsland.tsx`).
                ...(binding.pairableType === "charger"
                  ? { chargeBoxId: binding.pairableId }
                  : {}),
              })
            }\n\n`,
          ),
        );

        // Emit an HMAC-signed scan event to the client. Used by both
        // the docker-log path (charger only — log scraping intercepts
        // unknown tags) and the event-bus `scan.intercepted` path
        // (charger and device — the pre-auth hook + scan-result
        // handler emit it for known and unknown tags during an armed
        // window).
        const emit = (idTag: string, t: number): void => {
          (async () => {
            try {
              const nonce = await signNonce(
                idTag,
                binding.pairingCode,
                binding.pairableId,
                t,
              );
              safeEnqueue(
                _enc.encode(
                  `data: ${JSON.stringify({ idTag, nonce, t })}\n\n`,
                ),
              );
            } catch (err) {
              log.error("Failed to sign nonce", {
                error: err instanceof Error ? err.message : String(err),
              });
            }
          })();
        };

        // Charger-only: subscribe to the docker-log-subscriber for
        // OCPP log-scraped reject events. Device flow has no log
        // surface; skip.
        if (binding.pairableType === "charger") {
          const sub = await subscribe(
            (event) => {
              if (closed) return;
              // CRITICAL security check: only forward events whose
              // chargeBoxId matches the bound pairing. Null
              // chargeBoxId (couldn't parse from log line) is dropped
              // so an attacker can't get a non-bound event through by
              // triggering a tag scan against a charger whose
              // chargeBoxId we couldn't extract from logs.
              if (event.chargeBoxId !== binding.pairableId) return;
              // Only the reject path is relevant here; start-tx
              // events are handled by the watchdog, not customer
              // login.
              if (event.type !== "reject" || !event.idTag) return;
              emit(event.idTag, event.t);
            },
            (err) => {
              if (closed) return;
              log.warn("Underlying stream errored", { error: err.message });
              safeEnqueue(
                _enc.encode(
                  `event: error\ndata: ${
                    JSON.stringify({ error: err.message })
                  }\n\n`,
                ),
              );
              cleanup();
            },
          );
          if (!sub.available) {
            // Charger flow REQUIRES the docker-log fallback path —
            // surface the unavailability and close, matching the
            // pre-Wave-2 behavior so the existing integration test
            // semantics are preserved.
            safeEnqueue(
              _enc.encode(
                `event: error\ndata: ${
                  JSON.stringify({ error: "docker_unavailable" })
                }\n\n`,
              ),
            );
            cleanup();
            return;
          }
          unsubscribe = sub.unsubscribe;
        }

        // Subscribe to the event bus for:
        //   - `scan.intercepted` — pre-auth hook intercepts (charger
        //     source) and device-scan-result intercepts (device source).
        //     Filter on `(pairableType, pairableId, pairingCode)` — the
        //     legacy `chargeBoxId` field on the payload was removed in
        //     the Wave 1 Track A generalization.
        //   - `device.scan.cancelled` — bidirectional cancel sync. When
        //     the iOS app POSTs `/api/devices/scan-cancel` (or another
        //     admin's DELETE `/scan-arm` lands), this stream forwards a
        //     `cancelled` SSE event so the in-flight TapToAddModal can
        //     close. Only relevant for the device pair-type — charger
        //     pairings don't have a "remote cancel" surface.
        unsubBus = eventBus.subscribe(
          ["scan.intercepted", "device.scan.cancelled"],
          (delivered) => {
            if (closed) return;
            if (delivered.type === "scan.intercepted") {
              const p = delivered.payload as {
                idTag: string;
                pairableType: "charger" | "device";
                pairableId: string;
                pairingCode: string;
                purpose?: string;
                t: number;
                source?: string;
              };
              if (p.pairableType !== binding.pairableType) return;
              if (p.pairableId !== binding.pairableId) return;
              if (p.pairingCode !== binding.pairingCode) return;
              emit(p.idTag, p.t);
              return;
            }
            if (delivered.type === "device.scan.cancelled") {
              if (binding.pairableType !== "device") return;
              const p = delivered.payload as {
                deviceId: string;
                pairingCode: string;
                cancelledAt: number;
                source: "admin" | "device";
              };
              if (p.deviceId !== binding.pairableId) return;
              if (p.pairingCode !== binding.pairingCode) return;
              safeEnqueue(
                _enc.encode(
                  `event: cancelled\ndata: ${
                    JSON.stringify({
                      pairingCode: p.pairingCode,
                      cancelledAt: p.cancelledAt,
                      source: p.source,
                    })
                  }\n\n`,
                ),
              );
              cleanup();
              return;
            }
          },
        );

        // Replay buffered scan.intercepted events from the last ~5s
        // that match this binding. Belt-and-braces against the
        // start-callback race: if the event-bus publish happens
        // between this stream opening and the subscribe call above,
        // the live subscriber misses it but the ring buffer caught
        // it.
        const replayCutoff = Date.now() - 5_000;
        for (
          const delivered of eventBus.replay(0, ["scan.intercepted"])
        ) {
          if (closed) break;
          if (delivered.ts <= replayCutoff) continue;
          const p = delivered.payload as {
            idTag: string;
            pairableType: "charger" | "device";
            pairableId: string;
            pairingCode: string;
            purpose?: string;
            t: number;
            source?: string;
          };
          if (p.pairableType !== binding.pairableType) continue;
          if (p.pairableId !== binding.pairableId) continue;
          if (p.pairingCode !== binding.pairingCode) continue;
          emit(p.idTag, p.t);
        }

        // Keep-alive every 15s.
        keepaliveInterval = setInterval(() => {
          safeEnqueue(_enc.encode(`: keepalive\n\n`));
        }, KEEPALIVE_MS);

        // Hard 60s server-side cap.
        timeoutTimer = setTimeout(() => {
          if (closed) return;
          safeEnqueue(
            _enc.encode(
              `event: timeout\ndata: ${
                JSON.stringify({ message: "Detection timeout reached" })
              }\n\n`,
            ),
          );
          cleanup();
        }, TIMEOUT_MS);
      },
      cancel: () => {
        cleanup();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  },
});

// Test-only export — used by integration tests to assert per-IP cleanup.
export const _concurrentByIpForTests = concurrentByIp;

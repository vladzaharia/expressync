/**
 * GET /api/auth/scan-detect?pairingCode=X&chargeBoxId=Y
 *
 * Polaris Track C — public SSE endpoint that streams matching tag-scan
 * events for a previously armed pairing. The customer login UI opens
 * this stream after `/api/auth/scan-pair` returns; on the first matching
 * event it POSTs `/api/auth/scan-login` to complete the flow.
 *
 * Per-event payload:
 *   data: { idTag, nonce, t }
 *   where:
 *     - idTag: the OCPP id-tag string from the StEvE log line
 *     - t: server-side wall-clock at parse time (Date.now())
 *     - nonce: HMAC-SHA256(AUTH_SECRET, `${idTag}:${pairingCode}:${chargeBoxId}:${t}`)
 *
 * Server filters events by chargeBoxId so events from OTHER chargers are
 * NOT delivered to this listener — the security binding that defeats the
 * earlier cross-pickup attack.
 *
 * Concurrency:
 *   - Per-IP cap: 3 simultaneous connections (in-process Map). When the
 *     cap is hit, the 4th returns 429.
 *   - Server-side timeout: 60s with no consumer activity → close.
 *   - Keep-alive heartbeat every 15s.
 */

import { sql } from "drizzle-orm";
import { define } from "../../../utils.ts";
import { db } from "../../../src/db/index.ts";
import { config } from "../../../src/lib/config.ts";
import {
  FEATURE_SCAN_LOGIN,
  featureDisabledResponse,
} from "../../../src/lib/feature-flags.ts";
import { subscribe } from "../../../src/services/docker-log-subscriber.ts";
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

/** Compute HMAC-SHA256 over `${idTag}:${pairingCode}:${chargeBoxId}:${t}`. */
async function signNonce(
  idTag: string,
  pairingCode: string,
  chargeBoxId: string,
  t: number,
): Promise<string> {
  const key = await getHmacKey();
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    _enc.encode(`${idTag}:${pairingCode}:${chargeBoxId}:${t}`),
  );
  return hexEncode(sig);
}

export const handler = define.handlers({
  async GET(ctx) {
    if (!FEATURE_SCAN_LOGIN) {
      return featureDisabledResponse("scan-login");
    }
    const url = new URL(ctx.req.url);
    const pairingCode = url.searchParams.get("pairingCode") ?? "";
    const chargeBoxId = url.searchParams.get("chargeBoxId") ?? "";
    if (!pairingCode || !chargeBoxId) {
      return jsonResponse(400, {
        error: "pairingCode_and_chargeBoxId_required",
      });
    }

    const ip = getClientIp(ctx.req);
    const cur = concurrentByIp.get(ip) ?? 0;
    if (cur >= MAX_CONCURRENT_PER_IP) {
      return jsonResponse(429, { error: "too_many_concurrent_streams" });
    }

    // Verify the pairing is armed and not expired.
    const identifier = `scan-pair:${chargeBoxId}:${pairingCode}`;
    let armed = false;
    try {
      const result = await db.execute<{ id: string }>(sql`
        SELECT id FROM verifications
        WHERE identifier = ${identifier}
          AND expires_at > now()
          AND value::jsonb->>'status' = 'armed'
        LIMIT 1
      `);
      const list = Array.isArray(result)
        ? result
        : (result as { rows?: unknown[] }).rows ?? [];
      armed = list.length > 0;
    } catch (err) {
      log.error("Failed pairing lookup", {
        error: err instanceof Error ? err.message : String(err),
      });
      return jsonResponse(500, { error: "internal" });
    }
    if (!armed) {
      // Generic 404 — never tell the caller WHY (expired vs unknown vs
      // consumed) so they can't enumerate codes.
      return jsonResponse(404, { error: "pairing_not_found" });
    }

    // Reserve a slot for this IP. Released in the cleanup path below.
    concurrentByIp.set(ip, cur + 1);

    let unsubscribe: (() => void) | null = null;
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
        // Connected event so the client knows the stream is live.
        safeEnqueue(
          _enc.encode(
            `event: connected\ndata: ${
              JSON.stringify({ chargeBoxId, expiresInSec: TIMEOUT_MS / 1000 })
            }\n\n`,
          ),
        );

        const sub = await subscribe(
          (event) => {
            if (closed) return;
            // CRITICAL security check: only forward events whose
            // chargeBoxId matches the bound pairing. Null chargeBoxId
            // (couldn't parse from log line) is dropped so an attacker
            // can't get a non-bound event through by triggering a tag
            // scan against a charger whose chargeBoxId we couldn't
            // extract from logs.
            if (event.chargeBoxId !== chargeBoxId) return;

            // Fire-and-forget the HMAC signing — keep the handler
            // synchronous-ish so subscriber dispatch doesn't pile up.
            (async () => {
              try {
                const nonce = await signNonce(
                  event.idTag,
                  pairingCode,
                  chargeBoxId,
                  event.t,
                );
                safeEnqueue(
                  _enc.encode(
                    `data: ${
                      JSON.stringify({ idTag: event.idTag, nonce, t: event.t })
                    }\n\n`,
                  ),
                );
              } catch (err) {
                log.error("Failed to sign nonce", {
                  error: err instanceof Error ? err.message : String(err),
                });
              }
            })();
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

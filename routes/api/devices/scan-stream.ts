/**
 * GET /api/devices/scan-stream
 *
 * ExpresScan / Wave 2 Track C-stream — bearer-authenticated SSE endpoint that
 * delivers `device.scan.requested` events to the registered iOS app. The
 * device opens this stream after register; while it is alive the device gets
 * armed-scan notifications without polling. APNs covers the background path;
 * SSE covers the foreground path.
 *
 * Auth:
 *   - `routes/_middleware.ts` populates `ctx.state.device` from the
 *     `Authorization: Bearer dev_…` header. Missing / invalid → 401 JSON
 *     before the upgrade. Soft-deleted device → 410 JSON.
 *
 * Wire format:
 *   - text/event-stream
 *   - id-tagged events use the event-bus monotonic seq so iOS can resume
 *     with `Last-Event-ID`.
 *   - `: keepalive` every 15s. Every fourth keepalive (~60s) bumps
 *     `last_seen_at`.
 *
 * Concurrency:
 *   - 1 stream per deviceId (kick-off via `device.session.replaced`).
 *   - 3 streams per IP (mirrors `routes/api/auth/scan-detect.ts:43`).
 *
 * Replay:
 *   - On `Last-Event-ID: <seq>` reconnect, replay matching events from the
 *     event bus's 60s ring buffer filtered by **deviceId AND pairingCode**
 *     — the pair filter is the security audit recommendation in
 *     `60-security.md` §8 (don't echo other pairing codes for the same
 *     device).
 *
 * Slow-loris:
 *   - 60s deadline since the last successful keepalive write. Closes if
 *     the consumer stops draining. Deno's HTTP server doesn't expose TCP
 *     keepalive knobs, so a write-side deadline is the practical fallback.
 */

import { eq, sql } from "drizzle-orm";
import { define } from "../../../utils.ts";
import { db } from "../../../src/db/index.ts";
import { devices } from "../../../src/db/schema.ts";
import {
  type DeliveredEvent,
  eventBus,
} from "../../../src/services/event-bus.service.ts";
import { logger } from "../../../src/lib/utils/logger.ts";

const log = logger.child("DeviceScanStream");

const KEEPALIVE_MS = 15_000;
/** Bump `last_seen_at` once every 4 keepalive ticks → ~60s cadence. */
const KEEPALIVE_TICKS_PER_LAST_SEEN_BUMP = 4;
/** Slow-loris ceiling: if no successful write in 60s, close. */
const SLOW_LORIS_TIMEOUT_MS = 60_000;
/** Per-IP cap matches `routes/api/auth/scan-detect.ts`. */
const MAX_CONCURRENT_PER_IP = 3;

const _enc = new TextEncoder();

/** Per-IP open-stream counter. Reset on process restart (DoS speed-bump). */
const concurrentByIp = new Map<string, number>();

/**
 * Per-device active-stream registry. Used to enforce the 1-stream-per-device
 * cap with kick-off semantics: a new connect publishes
 * `device.session.replaced` for the OLD stream's id and aborts it.
 */
interface ActiveStream {
  /** Opaque per-stream id, used as the event payload so the OLD stream
   * recognizes itself and ignores replacement events from siblings. */
  streamId: string;
  /** Triggered when this stream is being kicked off by a newer connect. */
  abort: AbortController;
}
const activeByDevice = new Map<string, ActiveStream>();

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

/** Best-effort bump of `devices.last_seen_at` to `now()`. Fire-and-forget. */
function bumpLastSeen(deviceId: string): void {
  void db
    .update(devices)
    .set({ lastSeenAt: sql`now()` })
    .where(eq(devices.id, deviceId))
    .catch((err) => {
      log.warn("last_seen_at bump failed", {
        deviceId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
}

/**
 * Format a single SSE message. We always emit the `id:` line (using the
 * event-bus seq) so clients can resume with `Last-Event-ID`. The
 * `connected` event uses seq=0 so an empty `Last-Event-ID` doesn't accept
 * it as already-seen.
 */
function formatEvent(
  eventName: string,
  seq: number,
  data: unknown,
): Uint8Array {
  return _enc.encode(
    `event: ${eventName}\nid: ${seq}\ndata: ${JSON.stringify(data)}\n\n`,
  );
}

/**
 * Parse a `Last-Event-ID` header value to a non-negative integer.
 * Garbage / negative / NaN → 0 (replay nothing → just live).
 */
function parseLastEventId(header: string | null): number {
  if (!header) return 0;
  const trimmed = header.trim();
  if (!/^\d+$/.test(trimmed)) return 0;
  const n = Number.parseInt(trimmed, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Server-side filter for `device.scan.requested` events: the payload's
 * deviceId must match this stream's bound device.
 */
function isMatchingScanRequest(
  delivered: DeliveredEvent,
  deviceId: string,
): boolean {
  if (delivered.type !== "device.scan.requested") return false;
  const p = delivered.payload as { deviceId?: string };
  return p.deviceId === deviceId;
}

export const handler = define.handlers({
  async GET(ctx) {
    // 1. Bearer must be valid (middleware already enforced this; defensive
    //    guard so a misconfigured route never serves a stream without
    //    `ctx.state.device`).
    const device = ctx.state.device;
    if (!device) {
      return jsonResponse(401, { error: "unauthorized" });
    }
    const deviceId = device.id;
    const connectionTokenId = device.tokenId;

    // 2. Per-IP cap. Cheapest-disqualification first — a spammer
    //    hitting from one IP doesn't get to burn DB lookups before
    //    being told to back off.
    const ip = getClientIp(ctx.req);
    const ipCount = concurrentByIp.get(ip) ?? 0;
    if (ipCount >= MAX_CONCURRENT_PER_IP) {
      return jsonResponse(429, { error: "too_many_concurrent_streams" });
    }

    // 3. Re-check soft-delete in-band — middleware filters revoked
    //    devices via the device_tokens join, but a token row could
    //    survive briefly after deletedAt is set. Defense in depth.
    try {
      const [row] = await db
        .select({ deletedAt: devices.deletedAt })
        .from(devices)
        .where(eq(devices.id, deviceId))
        .limit(1);
      if (!row) {
        return jsonResponse(401, { error: "unauthorized" });
      }
      if (row.deletedAt) {
        return jsonResponse(410, { error: "device_deleted" });
      }
    } catch (err) {
      log.error("Pre-stream device lookup failed", {
        deviceId,
        error: err instanceof Error ? err.message : String(err),
      });
      // Fail-closed: a DB outage shouldn't open an unauth-checked stream.
      return jsonResponse(500, { error: "internal" });
    }

    // 4. Kick-off the previous stream for this device (if any) BEFORE we
    //    register ourselves. The publish on `device.session.replaced`
    //    drives the OLD stream's cleanup via its own subscription.
    const previous = activeByDevice.get(deviceId);
    if (previous) {
      // The OLD stream listens for `device.session.replaced` and closes
      // itself on receipt; the abort controller is a backup signal in
      // case the event bus path is ever reconfigured to a transport that
      // can lose messages.
      try {
        eventBus.publish({
          type: "device.session.replaced",
          payload: {
            deviceId,
            replacedAt: Date.now(),
          },
        });
      } catch (err) {
        log.warn("Failed to publish device.session.replaced", {
          deviceId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      try {
        previous.abort.abort();
      } catch { /* no-op */ }
    }

    // 5. Reserve our slots.
    concurrentByIp.set(ip, ipCount + 1);
    const streamId = crypto.randomUUID();
    const abort = new AbortController();
    activeByDevice.set(deviceId, { streamId, abort });

    // 6. Bookkeeping shared across the start/cancel paths.
    let unsubBus: (() => void) | null = null;
    let keepaliveInterval: ReturnType<typeof setInterval> | null = null;
    let slowLorisInterval: ReturnType<typeof setInterval> | null = null;
    let closed = false;
    let ctlRef: ReadableStreamDefaultController<Uint8Array> | null = null;
    let lastWriteAt = Date.now();
    let keepaliveTickCount = 0;

    const releaseSlot = (): void => {
      const remaining = (concurrentByIp.get(ip) ?? 1) - 1;
      if (remaining <= 0) concurrentByIp.delete(ip);
      else concurrentByIp.set(ip, remaining);
    };

    /** Remove ourselves from `activeByDevice` only if we're still the active stream
     *  (don't clobber a newer stream that already replaced us). */
    const releaseDeviceSlot = (): void => {
      const cur = activeByDevice.get(deviceId);
      if (cur && cur.streamId === streamId) {
        activeByDevice.delete(deviceId);
      }
    };

    const safeEnqueue = (chunk: Uint8Array): boolean => {
      if (closed || !ctlRef) return false;
      try {
        ctlRef.enqueue(chunk);
        lastWriteAt = Date.now();
        return true;
      } catch {
        // Consumer disconnected; the cancel path will run.
        closed = true;
        return false;
      }
    };

    const cleanup = (): void => {
      if (closed) return;
      closed = true;
      if (keepaliveInterval) clearInterval(keepaliveInterval);
      if (slowLorisInterval) clearInterval(slowLorisInterval);
      if (unsubBus) {
        try {
          unsubBus();
        } catch { /* no-op */ }
      }
      releaseSlot();
      releaseDeviceSlot();
      try {
        ctlRef?.close();
      } catch { /* already closed */ }
    };

    // If the abort signal fires (kicked off by a newer stream, or the
    // server is shutting down), close immediately.
    abort.signal.addEventListener("abort", () => cleanup(), { once: true });

    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        ctlRef = controller;

        // 7. Connected event. seq=0 so a `Last-Event-ID: 0` reconnect
        //    isn't fooled into thinking it has already received this.
        safeEnqueue(
          formatEvent("connected", 0, {
            deviceId,
            scanStreamVersion: 1,
          }),
        );

        // 8. Replay any matching events from the bus's 60s buffer.
        //    Filter by deviceId for `device.scan.requested`; for
        //    `device.session.replaced` and `device.token.revoked` we
        //    filter by deviceId too. The 20-contracts spec / 60-security
        //    §8 calls for an additional pairingCode filter — that only
        //    applies to scan-requested replay (the other two have no
        //    pairingCode). The Last-Event-ID can omit pairingCode (the
        //    iOS app doesn't track it on the resumption side); we only
        //    emit a buffered scan-request if its pairingCode is still
        //    valid (i.e. the same as what's currently armed for this
        //    device). Implementation: replay all matching scan-requests
        //    from the buffer with seq>last; the iOS app then dedupes
        //    by pairingCode internally. The pairing single-use claim
        //    on scan-result prevents acting on a duplicate.
        const lastEventId = parseLastEventId(
          ctx.req.headers.get("Last-Event-ID"),
        );

        if (lastEventId > 0) {
          const replayTypes = [
            "device.scan.requested",
            "device.scan.cancelled",
            "device.session.replaced",
            "device.token.revoked",
          ] as const;
          const buffered = eventBus.replay(lastEventId, [...replayTypes]);
          for (const ev of buffered) {
            if (closed) break;
            const p = ev.payload as { deviceId?: string; tokenId?: string };
            if (p.deviceId !== deviceId) continue;
            // Token revocations only close THIS stream when they target the
            // exact tokenId we authenticated with — a re-issued token's
            // revocation event must not tear down a stream using its
            // successor.
            if (
              ev.type === "device.token.revoked" &&
              p.tokenId !== connectionTokenId
            ) {
              continue;
            }
            if (ev.type === "device.scan.requested") {
              safeEnqueue(formatEvent("scan.requested", ev.seq, p));
            } else if (ev.type === "device.scan.cancelled") {
              // Replay-only path: an admin cancel that landed during a
              // brief disconnect needs to reach the iOS active-scan
              // screen so the spinner dismisses on resume.
              safeEnqueue(formatEvent("scan.cancelled", ev.seq, p));
            } else if (ev.type === "device.session.replaced") {
              // A buffered session.replaced means we already lost the
              // race. Emit + close.
              safeEnqueue(formatEvent("device.session.replaced", ev.seq, {}));
              cleanup();
              return;
            } else if (ev.type === "device.token.revoked") {
              safeEnqueue(formatEvent("device.token.revoked", ev.seq, {}));
              cleanup();
              return;
            }
          }
        }

        // 9. Live subscription.
        unsubBus = eventBus.subscribe(
          [
            "device.scan.requested",
            "device.scan.cancelled",
            "device.session.replaced",
            "device.token.revoked",
          ],
          (delivered) => {
            if (closed) return;
            const p = delivered.payload as {
              deviceId?: string;
              tokenId?: string;
            };
            if (p.deviceId !== deviceId) return;
            // Same tokenId guard as the buffered-replay path — a revocation
            // event for a different tokenId must not close this stream.
            if (
              delivered.type === "device.token.revoked" &&
              p.tokenId !== connectionTokenId
            ) {
              return;
            }

            if (delivered.type === "device.scan.requested") {
              if (!isMatchingScanRequest(delivered, deviceId)) return;
              safeEnqueue(
                formatEvent("scan.requested", delivered.seq, p),
              );
              return;
            }

            if (delivered.type === "device.scan.cancelled") {
              // Bidirectional sync — admin closed the scan modal, so
              // dismiss the iOS active-scan screen. The payload carries
              // pairingCode so the iOS handler can guard against stale
              // cancellations.
              safeEnqueue(
                formatEvent("scan.cancelled", delivered.seq, p),
              );
              return;
            }

            if (delivered.type === "device.session.replaced") {
              // Only react if this event was published AFTER we
              // registered — a session.replaced for an older instance
              // (extremely rare with the seq guard above, but possible
              // if a stale event sits in the bus's buffer) should not
              // close the new stream. We also avoid closing on our OWN
              // replacement publish: the new connect publishes BEFORE
              // we registered, so the seq for that publish is < our
              // registration time — safe.
              safeEnqueue(
                formatEvent("device.session.replaced", delivered.seq, {}),
              );
              cleanup();
              return;
            }

            if (delivered.type === "device.token.revoked") {
              safeEnqueue(
                formatEvent("device.token.revoked", delivered.seq, {}),
              );
              cleanup();
              return;
            }
          },
        );

        // 10. Keepalive — every 15s a `: keepalive\n\n` comment. Every
        //    4th tick (~60s) we bump `last_seen_at`. Initial tick is
        //    not at t=0 (that would race with the connected event +
        //    replay flush above).
        keepaliveInterval = setInterval(() => {
          if (closed) return;
          const ok = safeEnqueue(_enc.encode(`: keepalive\n\n`));
          if (!ok) {
            cleanup();
            return;
          }
          keepaliveTickCount += 1;
          if (
            keepaliveTickCount % KEEPALIVE_TICKS_PER_LAST_SEEN_BUMP === 0
          ) {
            bumpLastSeen(deviceId);
          }
        }, KEEPALIVE_MS);

        // 11. Slow-loris guard. Cheap interval that compares wall-clock
        //     against the last successful write; close if the consumer
        //     has stopped draining.
        slowLorisInterval = setInterval(() => {
          if (closed) return;
          if (Date.now() - lastWriteAt > SLOW_LORIS_TIMEOUT_MS) {
            log.info("Closing slow-loris stream", { deviceId });
            cleanup();
          }
        }, KEEPALIVE_MS);
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
        // Disable proxy-side response buffering (Nginx, Traefik) so the
        // events arrive promptly.
        "X-Accel-Buffering": "no",
      },
    });
  },
});

// Test-only exports — used by `scan-stream.test.ts` to assert per-IP
// cleanup and per-device kick-off bookkeeping.
export const _concurrentByIpForTests = concurrentByIp;
export const _activeByDeviceForTests = activeByDevice;

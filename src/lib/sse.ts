/**
 * SSE transport helpers (Phase P7).
 *
 * Wraps a `TransformStream<Uint8Array>` so route handlers can write SSE frames
 * from event-bus subscriptions without re-implementing the framing, heartbeat,
 * replay, and idle-drop logic each time.
 *
 * Memory cap: a process-global counter enforces `MAX_CONNECTIONS` across every
 * SSE endpoint. When the cap is hit, `openSseStream` returns `null` and the
 * caller should respond 503 so the client falls back to polling.
 *
 * Idle drop: if the server hasn't written for `IDLE_TIMEOUT_MS`, we close the
 * stream. Heartbeats fire every `HEARTBEAT_MS`, so in practice idle drop only
 * kicks in if the heartbeat loop itself stalls (e.g. backpressure).
 */

import {
  type DeliveredEvent,
  eventBus,
  type EventBusEventType,
} from "../../src/services/event-bus.service.ts";
import { logger } from "./utils/logger.ts";

const log = logger.child("SSE");

export const MAX_CONNECTIONS = 100;
export const HEARTBEAT_MS = 15_000;
export const IDLE_TIMEOUT_MS = 5 * 60_000;

let openConnections = 0;

/** Parse `Last-Event-ID` header into a numeric seq, or 0 if absent/invalid. */
export function parseLastEventId(req: Request): number {
  const raw = req.headers.get("last-event-id") ??
    req.headers.get("Last-Event-ID");
  if (!raw) return 0;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export interface SseStreamOptions {
  /** Event-bus types to subscribe to (null/empty = subscribe to all). */
  types: EventBusEventType[] | null;
  /**
   * Optional post-filter. Return `false` to drop a delivered event (e.g. a
   * notification.created that targets another admin). Runs after subscribe
   * type match; cheaper than many fine-grained subscriptions.
   */
  filter?: (event: DeliveredEvent) => boolean;
  /** Starting seq for replay — usually from `Last-Event-ID`. */
  lastEventId?: number;
  /** Tag used in log lines; helps tell streams apart. */
  label: string;
  /** Incoming request — for client close detection via `req.signal`. */
  signal: AbortSignal;
}

export function currentSseConnections(): number {
  return openConnections;
}

/**
 * Create a `Response` bound to an SSE stream. Returns `null` when the
 * connection cap is reached — the caller should reply 503.
 */
export function openSseStream(opts: SseStreamOptions): Response | null {
  if (openConnections >= MAX_CONNECTIONS) {
    log.warn("Rejecting SSE connect — cap reached", {
      label: opts.label,
      openConnections,
    });
    return null;
  }

  const encoder = new TextEncoder();
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();

  let closed = false;
  let lastWriteTs = Date.now();
  openConnections += 1;

  const safeClose = () => {
    if (closed) return;
    closed = true;
    openConnections = Math.max(0, openConnections - 1);
    try {
      writer.close();
    } catch {
      /* ignore */
    }
  };

  const writeRaw = async (chunk: string) => {
    if (closed) return;
    try {
      await writer.write(encoder.encode(chunk));
      lastWriteTs = Date.now();
    } catch (err) {
      log.debug("SSE write failed; closing stream", {
        label: opts.label,
        error: err instanceof Error ? err.message : String(err),
      });
      safeClose();
    }
  };

  const writeEvent = (e: DeliveredEvent) => {
    // SSE frame: `id: {seq}\nevent: {type}\ndata: {JSON}\n\n`
    const data = JSON.stringify(e.payload);
    void writeRaw(
      `id: ${e.seq}\nevent: ${e.type}\ndata: ${data}\n\n`,
    );
  };

  // --- Prologue: retry hint + replay buffer --------------------------------
  void writeRaw(`retry: 5000\n\n`);
  if (opts.lastEventId && opts.lastEventId > 0) {
    const replay = eventBus.replay(
      opts.lastEventId,
      opts.types ?? undefined,
    );
    for (const ev of replay) {
      if (opts.filter && !opts.filter(ev)) continue;
      writeEvent(ev);
    }
  }

  // --- Subscribe to the event bus -----------------------------------------
  const unsubscribe = eventBus.subscribe(opts.types, (ev) => {
    if (opts.filter && !opts.filter(ev)) return;
    writeEvent(ev);
  });

  // --- Heartbeat + idle drop ----------------------------------------------
  const heartbeatId = setInterval(() => {
    if (closed) return;
    void writeRaw(`event: heartbeat\ndata: {"ts":${Date.now()}}\n\n`);
  }, HEARTBEAT_MS);

  const idleId = setInterval(() => {
    if (closed) return;
    if (Date.now() - lastWriteTs > IDLE_TIMEOUT_MS) {
      log.info("Closing idle SSE stream", { label: opts.label });
      cleanup();
    }
  }, HEARTBEAT_MS);

  const cleanup = () => {
    clearInterval(heartbeatId);
    clearInterval(idleId);
    try {
      unsubscribe();
    } catch {
      /* ignore */
    }
    safeClose();
  };

  // Client-initiated disconnect (tab closed, navigation, abort).
  if (opts.signal.aborted) {
    cleanup();
  } else {
    opts.signal.addEventListener("abort", cleanup, { once: true });
  }

  log.debug("SSE stream opened", {
    label: opts.label,
    openConnections,
    hasReplay: !!opts.lastEventId,
  });

  return new Response(stream.readable, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

/** Shared 503 response used when SSE is disabled or the cap is hit. */
export function sseDisabledResponse(reason: string): Response {
  return new Response(
    JSON.stringify({ error: reason }),
    {
      status: 503,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": "30",
      },
    },
  );
}

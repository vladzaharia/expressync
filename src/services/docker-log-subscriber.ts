/**
 * Polaris Track C — singleton Docker log subscriber + tag-detection event bus.
 *
 * The original `routes/api/admin/tag/detect.ts` opened a fresh Docker log
 * stream on every SSE connection. With both the admin tag-detect flow AND
 * the new customer scan-to-login flow consuming the same StEvE log stream,
 * a per-request stream would (a) fan out to multiple Docker socket
 * connections (resource leak), and (b) double-process every line.
 *
 * This module wraps the Docker log stream in a refcounted singleton:
 *
 *   - `subscribe(handler)` returns an `unsubscribe` function. The first
 *     subscriber kicks off the underlying Docker stream; subsequent
 *     subscribers attach to the in-process bus. The last unsubscribe stops
 *     the Docker stream.
 *   - Each line yielded by Docker is parsed for both a rejected idTag (via
 *     existing `extractRejectedTag`) AND a chargeBoxId (new — needed for
 *     the customer scan-login binding). Subscribers receive a structured
 *     event `{ idTag, chargeBoxId, t, rawLine }` per parsed scan.
 *
 * Failure modes:
 *   - If the Docker socket is unavailable, `subscribe()` returns immediately
 *     with `{ available: false, unsubscribe }`. Callers should respond 503.
 *   - If the underlying stream throws mid-flight, all current subscribers
 *     receive an `error` callback and the stream is restarted on next
 *     subscribe.
 *
 * Concurrency note: Deno's `EventTarget` is fine for this; we use a plain
 * Set of handlers because we want strongly typed callbacks rather than
 * generic Event objects.
 */

import { dockerClient } from "../lib/docker-client.ts";
import { logger } from "../lib/utils/logger.ts";
import { extractRejectedTag } from "../lib/utils/tag-patterns.ts";

const log = logger.child("DockerLogSubscriber");

/** Parsed scan event emitted to each subscriber. */
export interface ScanLogEvent {
  /** OCPP id-tag string parsed from the rejected/unknown-tag line. */
  idTag: string;
  /**
   * chargeBoxId parsed from the same log line if present. May be `null`
   * when the line doesn't contain a chargeBoxId (older StEvE format /
   * unmatched pattern). Customer scan-login REQUIRES a non-null value;
   * admin tag-detect tolerates null.
   */
  chargeBoxId: string | null;
  /** Server-side wall-clock at parse time (Date.now()). */
  t: number;
  /** Raw log line, truncated to 500 chars for safety. */
  rawLine: string;
}

export type ScanLogHandler = (event: ScanLogEvent) => void;
export type ScanLogErrorHandler = (err: Error) => void;

interface Subscriber {
  onEvent: ScanLogHandler;
  onError?: ScanLogErrorHandler;
}

interface SubscribeResult {
  /** True iff Docker is reachable and the stream is live. */
  available: boolean;
  /** Detach this subscriber. Idempotent. */
  unsubscribe: () => void;
}

// ---- Module-level singleton state ------------------------------------------

const subscribers = new Set<Subscriber>();
let streamRunning = false;
/**
 * AbortController used to stop the underlying Docker stream when the last
 * subscriber detaches. The Docker client returns an AsyncGenerator we can't
 * directly abort; we set a flag and rely on the `for await` loop to notice.
 */
let stopRequested = false;

// Patterns to extract chargeBoxId from a StEvE log line. StEvE logs the
// chargeBoxId in several formats — these patterns try each.
//
// Examples:
//   "...for chargeBoxId 'EVSE-1' and..."
//   "...chargeBoxId=EVSE-1..."
//   "...[CB01] Authorize.req received..."   (bracketed prefix)
const CHARGE_BOX_ID_PATTERNS: ReadonlyArray<RegExp> = [
  /chargeBoxId[=:\s]+['"]?([A-Za-z0-9_\-]+)['"]?/i,
  /charge_box_id[=:\s]+['"]?([A-Za-z0-9_\-]+)['"]?/i,
  /\[([A-Za-z0-9_\-]{2,})\]\s+(?:Authorize|StartTransaction|StatusNotification)/,
];

/**
 * Extract a chargeBoxId from a Docker log line. Returns null if no
 * pattern matches. The caller treats null as "no binding info; skip this
 * event for charger-scoped consumers".
 */
export function extractChargeBoxId(line: string): string | null {
  for (const pat of CHARGE_BOX_ID_PATTERNS) {
    const m = line.match(pat);
    if (m && m[1]) {
      return m[1];
    }
  }
  return null;
}

/** Notify every active subscriber. Errors in one handler don't affect others. */
function dispatch(event: ScanLogEvent): void {
  for (const sub of subscribers) {
    try {
      sub.onEvent(event);
    } catch (err) {
      log.error("Subscriber threw on event dispatch", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

function dispatchError(err: Error): void {
  for (const sub of subscribers) {
    try {
      sub.onError?.(err);
    } catch (handlerErr) {
      log.error("Subscriber threw on error handler", {
        error: handlerErr instanceof Error
          ? handlerErr.message
          : String(handlerErr),
      });
    }
  }
}

/**
 * Internal: drain the Docker log stream into the in-process bus until the
 * last subscriber detaches. Resilient to upstream errors — we restart on
 * next subscribe, never inside this loop.
 */
async function runStream(): Promise<void> {
  if (streamRunning) return;
  streamRunning = true;
  stopRequested = false;
  log.info("Starting shared Docker log stream", {
    subscriberCount: subscribers.size,
  });

  try {
    const logStream = dockerClient.streamLogs({
      follow: true,
      tail: 0,
      since: Math.floor(Date.now() / 1000),
    });
    for await (const line of logStream) {
      if (stopRequested || subscribers.size === 0) break;
      const idTag = extractRejectedTag(line);
      if (!idTag) continue;
      const chargeBoxId = extractChargeBoxId(line);
      const event: ScanLogEvent = {
        idTag,
        chargeBoxId,
        t: Date.now(),
        rawLine: line.length > 500 ? line.slice(0, 500) : line,
      };
      dispatch(event);
    }
  } catch (err) {
    log.error("Docker log stream error", {
      error: err instanceof Error ? err.message : String(err),
    });
    dispatchError(err instanceof Error ? err : new Error(String(err)));
  } finally {
    streamRunning = false;
    stopRequested = false;
    log.info("Shared Docker log stream stopped");
  }
}

/**
 * Subscribe to the shared Docker log stream. The first subscriber starts
 * the underlying stream; the last to unsubscribe stops it.
 *
 * Behavior when Docker is unavailable: returns `{ available: false }`
 * immediately and never invokes `onEvent`. Callers should handle this by
 * responding 503 to their SSE consumer.
 */
export async function subscribe(
  onEvent: ScanLogHandler,
  onError?: ScanLogErrorHandler,
): Promise<SubscribeResult> {
  const dockerAvailable = await dockerClient.isAvailable();
  if (!dockerAvailable) {
    return {
      available: false,
      unsubscribe: () => {},
    };
  }

  const sub: Subscriber = { onEvent, onError };
  subscribers.add(sub);
  if (!streamRunning) {
    // Fire-and-forget — runStream owns its own lifecycle and reports
    // errors through `dispatchError`.
    runStream().catch((err) => {
      log.error("runStream rejected unexpectedly", {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }
  let detached = false;
  return {
    available: true,
    unsubscribe: () => {
      if (detached) return;
      detached = true;
      subscribers.delete(sub);
      if (subscribers.size === 0) {
        // Signal the stream loop to stop on its next yield.
        stopRequested = true;
      }
    },
  };
}

/**
 * Test-only: introspect current subscriber count. Use only in tests.
 */
export function _subscriberCountForTests(): number {
  return subscribers.size;
}

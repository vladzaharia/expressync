import { define } from "../../../../utils.ts";
import { logger } from "../../../../src/lib/utils/logger.ts";
import { subscribe } from "../../../../src/services/docker-log-subscriber.ts";

/**
 * GET /api/admin/tag/detect
 *
 * Server-Sent Events endpoint for real-time OCPP tag detection.
 * Streams detected rejected/unknown tags from StEvE Docker logs.
 *
 * Polaris Track C: this used to open a fresh Docker log stream per
 * request. It now subscribes to the shared `docker-log-subscriber`
 * singleton so we don't fan out N Docker connections for N concurrent
 * SSE consumers (admin tag-detect + customer scan-detect).
 *
 * Query parameters:
 * - timeout: Maximum duration in seconds (default: 60)
 */
export const handler = define.handlers({
  GET(ctx) {
    const url = new URL(ctx.req.url);
    const timeout = parseInt(url.searchParams.get("timeout") || "60", 10);
    if (isNaN(timeout) || timeout < 1 || timeout > 300) {
      return new Response(
        JSON.stringify({ error: "Invalid timeout parameter (1-300)" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    logger.info("TagDetection", "Starting tag detection stream", { timeout });

    const encoder = new TextEncoder();
    const seenTags = new Set<string>();
    const startTime = Date.now();
    const timeoutMs = timeout * 1000;
    let unsubscribe: (() => void) | null = null;
    let keepaliveInterval: ReturnType<typeof setInterval> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    // Holds the controller so we can fan out from event handlers / timers.
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
      try {
        ctlRef?.close();
      } catch { /* already closed */ }
    };

    const stream = new ReadableStream<Uint8Array>({
      start: async (controller) => {
        ctlRef = controller;

        // Subscribe to the shared Docker log singleton. If Docker is
        // unavailable, we close the stream immediately and the client
        // will see the connection close (matches the previous 503-via-
        // HEAD-probe behavior — clients HEAD-probe before the EventSource).
        const sub = await subscribe(
          (event) => {
            if (closed) return;
            // Admin flow: dedupe by tag id + check timeout.
            if (Date.now() - startTime > timeoutMs) {
              safeEnqueue(
                encoder.encode(
                  `event: timeout\ndata: ${
                    JSON.stringify({ message: "Detection timeout reached" })
                  }\n\n`,
                ),
              );
              cleanup();
              return;
            }
            if (seenTags.has(event.idTag)) return;
            seenTags.add(event.idTag);
            logger.info("TagDetection", "Detected rejected tag", {
              tagId: event.idTag,
              chargeBoxId: event.chargeBoxId,
            });
            safeEnqueue(
              encoder.encode(
                `event: tag-detected\ndata: ${
                  JSON.stringify({
                    tagId: event.idTag,
                    chargeBoxId: event.chargeBoxId,
                    timestamp: new Date(event.t).toISOString(),
                    logLine: event.rawLine.substring(0, 200),
                  })
                }\n\n`,
              ),
            );
          },
          (err) => {
            if (closed) return;
            logger.error(
              "TagDetection",
              "Stream error from shared subscriber",
              err,
            );
            safeEnqueue(
              encoder.encode(
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
            encoder.encode(
              `event: error\ndata: ${
                JSON.stringify({
                  error: "Docker socket not available",
                  message: "Cannot connect to Docker to stream StEvE logs",
                })
              }\n\n`,
            ),
          );
          cleanup();
          return;
        }
        unsubscribe = sub.unsubscribe;

        // Initial connected event (matches existing client contract).
        safeEnqueue(
          encoder.encode(
            `event: connected\ndata: ${JSON.stringify({ timeout })}\n\n`,
          ),
        );

        // Keepalive every 15s to prevent proxy/browser timeouts.
        keepaliveInterval = setInterval(() => {
          safeEnqueue(encoder.encode(`: keepalive\n\n`));
        }, 15_000);

        // Hard server-side timeout cap.
        timeoutTimer = setTimeout(() => {
          if (closed) return;
          safeEnqueue(
            encoder.encode(
              `event: timeout\ndata: ${
                JSON.stringify({ message: "Detection timeout reached" })
              }\n\n`,
            ),
          );
          cleanup();
        }, timeoutMs);
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

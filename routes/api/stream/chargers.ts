/**
 * GET /api/stream/chargers — admin-gated SSE multiplex.
 *
 * Streams: `charger.state`, `transaction.meter`, `tag.seen`, `sync.completed`.
 * Heartbeat every 15s. Supports `Last-Event-ID` replay within the event-bus'
 * 60-second ring buffer.
 *
 * Designed for the Phase-L charger live-status / detail view; `SseProvider`
 * mirrors these events to every tab via `BroadcastChannel` so only one tab
 * per browser actually holds the EventSource.
 */

import { define } from "../../../utils.ts";
import { config } from "../../../src/lib/config.ts";
import {
  openSseStream,
  parseLastEventId,
  sseDisabledResponse,
} from "../../../src/lib/sse.ts";

export const handler = define.handlers({
  GET(ctx) {
    if (!config.ENABLE_SSE) {
      return sseDisabledResponse("SSE disabled (ENABLE_SSE=false)");
    }

    const stream = openSseStream({
      label: "chargers",
      types: [
        "charger.state",
        "transaction.meter",
        "tag.seen",
        "sync.completed",
      ],
      lastEventId: parseLastEventId(ctx.req),
      signal: ctx.req.signal,
    });

    if (!stream) {
      return sseDisabledResponse("SSE connection cap reached");
    }
    return stream;
  },
});

/**
 * GET /api/notifications/stream — SSE feed for the header bell (Phase P7).
 *
 * Emits `notification.created` and `notification.read` events filtered to the
 * authenticated admin (broadcast rows + rows targeted at them). Heartbeat
 * every 15s. Supports `Last-Event-ID` replay within the event-bus' 60-second
 * ring buffer.
 *
 * When `ENABLE_SSE=false`, replies 503 so the client falls through to the
 * existing 30s `/unread-count` polling path.
 */

import { define } from "../../../../utils.ts";
import { config } from "../../../../src/lib/config.ts";
import {
  openSseStream,
  parseLastEventId,
  sseDisabledResponse,
} from "../../../../src/lib/sse.ts";

export const handler = define.handlers({
  GET(ctx) {
    if (!config.ENABLE_SSE) {
      return sseDisabledResponse("SSE disabled (ENABLE_SSE=false)");
    }

    const userId = ctx.state.user?.id;
    if (!userId) {
      // Middleware normally catches this, but be explicit — bare 401 keeps
      // the stream from half-opening for unauthenticated requests.
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const stream = openSseStream({
      label: `notifications:${userId}`,
      types: ["notification.created", "notification.read"],
      lastEventId: parseLastEventId(ctx.req),
      signal: ctx.req.signal,
      filter: (ev) => {
        // Broadcast rows (adminUserId == null) go to everyone, targeted rows
        // only to their owner. `notification.read` carries the acting user's
        // id so we only echo a badge decrement to that admin's own tabs.
        if (ev.type === "notification.created") {
          const target = (ev.payload as { adminUserId?: string | null })
            .adminUserId;
          return target === null || target === undefined || target === userId;
        }
        if (ev.type === "notification.read") {
          const target = (ev.payload as { adminUserId?: string })
            .adminUserId;
          return target === userId;
        }
        return true;
      },
    });

    if (!stream) {
      return sseDisabledResponse("SSE connection cap reached");
    }
    return stream;
  },
});

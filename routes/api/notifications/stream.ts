/**
 * GET /api/notifications/stream
 *
 * SSE scaffold — wired in Phase P7 (gated on user sign-off). Returns 501 Not
 * Implemented for the MVP so the route name is reserved; `NotificationBell`
 * polls `/unread-count` instead.
 *
 * When Phase P7 ships: replace the body with a `text/event-stream` response
 * that emits `notification` events on insert. Polling in `NotificationBell`
 * should fall back to `/unread-count` if this endpoint 501s so a single
 * client-side flag controls the rollout.
 */

import { define } from "../../../utils.ts";

export const handler = define.handlers({
  GET(_ctx) {
    return new Response(
      JSON.stringify({
        error:
          "SSE stream not implemented (Phase P7 — polling fallback active)",
      }),
      {
        status: 501,
        headers: { "Content-Type": "application/json" },
      },
    );
  },
});

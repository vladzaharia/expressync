/**
 * GET /api/notifications/unread-count
 *
 * Lightweight count endpoint polled by the header NotificationBell every 30s
 * (and on visibility change). Returns `{ count }` — we keep the surface tiny
 * because every admin browser will hit this repeatedly.
 */

import { define } from "../../../../utils.ts";
import { getUnreadCount } from "../../../../src/services/notification.service.ts";
import { logger } from "../../../../src/lib/utils/logger.ts";

const log = logger.child("NotificationsAPI");

export const handler = define.handlers({
  async GET(ctx) {
    if (!ctx.state.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const count = await getUnreadCount(ctx.state.user.id);
      return new Response(JSON.stringify({ count }), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      });
    } catch (err) {
      log.error("Failed to count unread notifications", err as Error);
      return new Response(
        JSON.stringify({ error: "Failed to count unread notifications" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  },
});

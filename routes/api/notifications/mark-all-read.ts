/**
 * POST /api/notifications/mark-all-read
 *
 * Marks every unread notification visible to the caller (including broadcast
 * rows) as read. Returns `{ updated: number }`.
 */

import { define } from "../../../utils.ts";
import { markAllRead } from "../../../src/services/notification.service.ts";
import { logger } from "../../../src/lib/utils/logger.ts";

const log = logger.child("NotificationsAPI");

export const handler = define.handlers({
  async POST(ctx) {
    const user = ctx.state.user;
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const updated = await markAllRead(user.id);
      return new Response(JSON.stringify({ updated }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      log.error("Failed to mark all notifications read", err as Error);
      return new Response(
        JSON.stringify({ error: "Failed to mark notifications read" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  },
});

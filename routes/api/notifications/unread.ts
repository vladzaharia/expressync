/**
 * GET /api/notifications/unread
 *
 * Returns the most-recent unread notifications for the caller (including
 * broadcast rows). Used by the header NotificationBell dropdown when the user
 * opens it — we fetch on open rather than continuously poll so the dropdown
 * feels fresh but the polling cost stays on `/unread-count`.
 */

import { define } from "../../../utils.ts";
import { getUnread } from "../../../src/services/notification.service.ts";
import { logger } from "../../../src/lib/utils/logger.ts";

const log = logger.child("NotificationsAPI");

export const handler = define.handlers({
  async GET(ctx) {
    if (!ctx.state.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const url = new URL(ctx.req.url);
    const limitRaw = parseInt(url.searchParams.get("limit") ?? "5", 10);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(limitRaw, 1), 20)
      : 5;

    try {
      const items = await getUnread(ctx.state.user.id, limit);
      return new Response(JSON.stringify({ items }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      log.error("Failed to fetch unread notifications", err as Error);
      return new Response(
        JSON.stringify({ error: "Failed to fetch unread notifications" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  },
});

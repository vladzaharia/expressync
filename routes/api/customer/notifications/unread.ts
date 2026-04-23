/**
 * GET /api/customer/notifications/unread
 *
 * Customer bell — returns the most-recent unread, non-dismissed
 * notifications targeting the authenticated customer (or broadcast).
 *
 * Filter: `audience IN ('customer','all')` AND
 *         (`admin_user_id = $userId` OR (audience='all' AND admin_user_id IS NULL))
 */

import { define } from "../../../../utils.ts";
import { getCustomerUnread } from "../../../../src/services/notification.service.ts";
import { logger } from "../../../../src/lib/utils/logger.ts";

const log = logger.child("CustomerNotificationsAPI");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const handler = define.handlers({
  async GET(ctx) {
    if (!ctx.state.user) {
      return jsonResponse(401, { error: "Unauthorized" });
    }

    const url = new URL(ctx.req.url);
    const limitRaw = parseInt(url.searchParams.get("limit") ?? "5", 10);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(limitRaw, 1), 20)
      : 5;

    try {
      const targetUserId = ctx.state.actingAs ?? ctx.state.user.id;
      const items = await getCustomerUnread(targetUserId, limit);
      return jsonResponse(200, { items });
    } catch (err) {
      log.error("Failed to fetch customer unread notifications", err as Error);
      return jsonResponse(500, {
        error: "Failed to fetch unread notifications",
      });
    }
  },
});

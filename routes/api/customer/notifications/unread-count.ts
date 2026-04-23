/**
 * GET /api/customer/notifications/unread-count
 *
 * Lightweight count endpoint polled by the customer header bell every 30s.
 * Returns `{ count }`. Same audience filter as `/unread`.
 */

import { define } from "../../../../utils.ts";
import { getCustomerUnreadCount } from "../../../../src/services/notification.service.ts";
import { logger } from "../../../../src/lib/utils/logger.ts";

const log = logger.child("CustomerNotificationsAPI");

function jsonResponse(
  status: number,
  body: unknown,
  extra?: HeadersInit,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...(extra ?? {}) },
  });
}

export const handler = define.handlers({
  async GET(ctx) {
    if (!ctx.state.user) {
      return jsonResponse(401, { error: "Unauthorized" });
    }

    try {
      const targetUserId = ctx.state.actingAs ?? ctx.state.user.id;
      const count = await getCustomerUnreadCount(targetUserId);
      return jsonResponse(200, { count }, { "Cache-Control": "no-store" });
    } catch (err) {
      log.error(
        "Failed to count customer unread notifications",
        err as Error,
      );
      return jsonResponse(500, {
        error: "Failed to count unread notifications",
      });
    }
  },
});

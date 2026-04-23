/**
 * GET /api/customer/notifications
 *
 * Paginated archive listing for the customer's own notifications. Query
 * params mirror the admin equivalent:
 *   limit (1..100, default 25), skip|offset, severity, kind, sourceType,
 *   readState ('read'|'unread'|'any').
 */

import { define } from "../../../../utils.ts";
import {
  listCustomerArchive,
  type NotificationSourceType,
} from "../../../../src/services/notification.service.ts";
import type { NotificationSeverityValue } from "../../../../src/db/schema.ts";
import { logger } from "../../../../src/lib/utils/logger.ts";

const log = logger.child("CustomerNotificationsAPI");

const ALLOWED_SOURCE_TYPES: readonly NotificationSourceType[] = [
  "invoice",
  "alert",
  "subscription",
  "wallet_transaction",
  "webhook_event",
  "system",
  "mapping",
  "charger",
  "reservation",
];

const ALLOWED_SEVERITIES: readonly NotificationSeverityValue[] = [
  "info",
  "success",
  "warn",
  "error",
];

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
    const q = url.searchParams;
    const limitRaw = parseInt(q.get("limit") ?? "25", 10);
    const skipRaw = parseInt(q.get("skip") ?? q.get("offset") ?? "0", 10);
    const severityRaw = q.get("severity");
    const kindRaw = q.get("kind");
    const sourceTypeRaw = q.get("sourceType");
    const readStateRaw = q.get("readState");

    const severity = severityRaw &&
        ALLOWED_SEVERITIES.includes(severityRaw as NotificationSeverityValue)
      ? (severityRaw as NotificationSeverityValue)
      : null;
    const sourceType = sourceTypeRaw &&
        ALLOWED_SOURCE_TYPES.includes(sourceTypeRaw as NotificationSourceType)
      ? (sourceTypeRaw as NotificationSourceType)
      : null;

    let readState: boolean | undefined;
    if (readStateRaw === "read") readState = true;
    else if (readStateRaw === "unread") readState = false;

    try {
      const targetUserId = ctx.state.actingAs ?? ctx.state.user.id;
      const { items, total } = await listCustomerArchive(targetUserId, {
        limit: Number.isFinite(limitRaw) ? limitRaw : 25,
        offset: Number.isFinite(skipRaw) ? skipRaw : 0,
        severity,
        kind: kindRaw && kindRaw.length > 0 ? kindRaw : null,
        sourceType,
        readState,
      });
      return jsonResponse(200, { items, total });
    } catch (err) {
      log.error("Failed to list customer notifications", err as Error);
      return jsonResponse(500, {
        error: "Failed to list notifications",
      });
    }
  },
});

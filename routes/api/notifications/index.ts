/**
 * GET /api/notifications
 *
 * Archive listing with filters. Used by the NotificationArchiveTable island
 * for pagination ("Load More") and filter changes.
 *
 * Query params:
 *   limit        — page size (1..100, default 25)
 *   skip|offset  — offset for pagination (default 0)
 *   severity     — info|success|warn|error
 *   kind         — exact-match filter on notification.kind
 *   sourceType   — filter on notification.source_type
 *   readState    — 'read' | 'unread' | 'any' (default any)
 */

import { define } from "../../../utils.ts";
import {
  listArchive,
  type NotificationSourceType,
} from "../../../src/services/notification.service.ts";
import type { NotificationSeverityValue } from "../../../src/db/schema.ts";
import { logger } from "../../../src/lib/utils/logger.ts";

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

const log = logger.child("NotificationsAPI");

const ALLOWED_SEVERITIES: readonly NotificationSeverityValue[] = [
  "info",
  "success",
  "warn",
  "error",
];

export const handler = define.handlers({
  async GET(ctx) {
    if (!ctx.state.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
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

    let readState: boolean | undefined;
    if (readStateRaw === "read") readState = true;
    else if (readStateRaw === "unread") readState = false;

    const sourceType = sourceTypeRaw &&
        ALLOWED_SOURCE_TYPES.includes(sourceTypeRaw as NotificationSourceType)
      ? (sourceTypeRaw as NotificationSourceType)
      : null;

    try {
      const { items, total } = await listArchive({
        limit: Number.isFinite(limitRaw) ? limitRaw : 25,
        offset: Number.isFinite(skipRaw) ? skipRaw : 0,
        severity,
        kind: kindRaw && kindRaw.length > 0 ? kindRaw : null,
        sourceType,
        readState,
      });

      return new Response(JSON.stringify({ items, total }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      log.error("Failed to list archive", err as Error);
      return new Response(
        JSON.stringify({ error: "Failed to list notifications" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  },
});

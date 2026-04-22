import { define } from "@/utils.ts";
import { db } from "@/src/db/index.ts";
import { lagoWebhookEvents } from "@/src/db/schema.ts";
import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  isNotNull,
  isNull,
  lte,
  ne,
} from "drizzle-orm";

/**
 * GET /api/admin/webhook-events
 *
 * Paginated list of Lago webhook audit rows for the admin surface.
 *
 * Query params (all optional):
 *   - skip                  number (default 0)
 *   - limit                 number (default 25, max 100)
 *   - type                  exact match on webhook_type (e.g. "invoice.created")
 *   - status                "pending" | "processed" | "failed" | "skipped"
 *   - customer              partial match on external_customer_id (case-insensitive)
 *   - subscription          partial match on external_subscription_id
 *   - start                 ISO date — received_at >= start
 *   - end                   ISO date — received_at <= end
 *   - notification_fired    "1" | "true" → only rows that triggered an alert
 *                            "0" | "false" → only rows that didn't
 *
 * Response: { items: Row[], total: number, skip, limit }
 */
export const handler = define.handlers({
  async GET(ctx) {
    if (ctx.state.user?.role !== "admin") {
      return new Response(
        JSON.stringify({ error: "Forbidden: admin access required" }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
    }

    const url = new URL(ctx.req.url);
    const skip = Math.max(0, parseInt(url.searchParams.get("skip") ?? "0"));
    const rawLimit = parseInt(url.searchParams.get("limit") ?? "25");
    const limit = Math.min(100, Math.max(1, isNaN(rawLimit) ? 25 : rawLimit));

    const type = url.searchParams.get("type");
    const status = url.searchParams.get("status");
    const customer = url.searchParams.get("customer");
    const subscription = url.searchParams.get("subscription");
    const start = url.searchParams.get("start");
    const end = url.searchParams.get("end");
    const notificationFired = url.searchParams.get("notification_fired");

    const conditions = [];

    if (type) conditions.push(eq(lagoWebhookEvents.webhookType, type));
    if (customer) {
      conditions.push(
        ilike(lagoWebhookEvents.externalCustomerId, `%${customer}%`),
      );
    }
    if (subscription) {
      conditions.push(
        ilike(lagoWebhookEvents.externalSubscriptionId, `%${subscription}%`),
      );
    }
    if (start) {
      const startDate = new Date(start);
      if (!isNaN(startDate.getTime())) {
        conditions.push(gte(lagoWebhookEvents.receivedAt, startDate));
      }
    }
    if (end) {
      const endDate = new Date(end);
      if (!isNaN(endDate.getTime())) {
        endDate.setHours(23, 59, 59, 999);
        conditions.push(lte(lagoWebhookEvents.receivedAt, endDate));
      }
    }
    if (notificationFired === "1" || notificationFired === "true") {
      conditions.push(eq(lagoWebhookEvents.notificationFired, true));
    } else if (notificationFired === "0" || notificationFired === "false") {
      conditions.push(eq(lagoWebhookEvents.notificationFired, false));
    }

    // Derived-status filter: the table stores processedAt + processingError.
    // We translate the UI's derived `status` filter into SQL conditions.
    if (status === "pending") {
      conditions.push(isNull(lagoWebhookEvents.processedAt));
    } else if (status === "processed") {
      conditions.push(isNotNull(lagoWebhookEvents.processedAt));
      conditions.push(isNull(lagoWebhookEvents.processingError));
    } else if (status === "failed") {
      conditions.push(isNotNull(lagoWebhookEvents.processedAt));
      conditions.push(isNotNull(lagoWebhookEvents.processingError));
      conditions.push(
        ne(lagoWebhookEvents.processingError, "circuit_breaker_open"),
      );
    } else if (status === "skipped") {
      conditions.push(
        eq(lagoWebhookEvents.processingError, "circuit_breaker_open"),
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    try {
      const [totalRow] = await db
        .select({ value: count() })
        .from(lagoWebhookEvents)
        .where(whereClause);

      const items = await db
        .select({
          id: lagoWebhookEvents.id,
          webhookType: lagoWebhookEvents.webhookType,
          objectType: lagoWebhookEvents.objectType,
          lagoObjectId: lagoWebhookEvents.lagoObjectId,
          externalCustomerId: lagoWebhookEvents.externalCustomerId,
          externalSubscriptionId: lagoWebhookEvents.externalSubscriptionId,
          receivedAt: lagoWebhookEvents.receivedAt,
          processedAt: lagoWebhookEvents.processedAt,
          processingError: lagoWebhookEvents.processingError,
          notificationFired: lagoWebhookEvents.notificationFired,
          replayedFromId: lagoWebhookEvents.replayedFromId,
          replayedAt: lagoWebhookEvents.replayedAt,
          replayedByUserId: lagoWebhookEvents.replayedByUserId,
        })
        .from(lagoWebhookEvents)
        .where(whereClause)
        .orderBy(desc(lagoWebhookEvents.receivedAt))
        .offset(skip)
        .limit(limit);

      return new Response(
        JSON.stringify({
          items,
          total: totalRow.value,
          skip,
          limit,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return new Response(
        JSON.stringify({
          error: "Failed to list webhook events",
          details: message,
        }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  },
});

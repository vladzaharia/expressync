/**
 * GET /api/customer/sessions
 *
 * Customer-scoped paginated list of synced transaction events.
 *
 * Scope: `synced_transaction_events.user_mapping_id IN scope.mappingIds`.
 * Empty scope (no mappings owned) short-circuits to an empty page so admins
 * who hit this endpoint without `?as=` see zero rows instead of every
 * transaction.
 *
 * Query params:
 *   skip   — pagination offset (default 0)
 *   limit  — page size (default 25, max 100)
 *   from   — YYYY-MM-DD inclusive (filters synced_at)
 *   to     — YYYY-MM-DD inclusive (filters synced_at; clamped to 23:59:59)
 *   status — `active` (no `is_final`) | `completed` (`is_final=true`) — `failed`
 *            is reserved for a future column, currently no-op
 *
 * Response shape mirrors `routes/api/admin/transaction/index.ts`:
 *   { items, total, skip, limit }
 */

import { define } from "../../../../utils.ts";
import { db } from "../../../../src/db/index.ts";
import * as schema from "../../../../src/db/schema.ts";
import { and, count, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { resolveCustomerScope } from "../../../../src/lib/scoping.ts";
import {
  buildCumulativeMap,
  estimateEventCost,
  resolveCustomerTariff,
} from "../../../../src/lib/customer-tariff.ts";
import { periodWindow } from "../../../../src/lib/billing-derive.ts";
import { logger } from "../../../../src/lib/utils/logger.ts";

const log = logger.child("CustomerSessionsAPI");

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
    const skip = parseInt(url.searchParams.get("skip") ?? "0", 10);
    if (!Number.isFinite(skip) || skip < 0) {
      return jsonResponse(400, { error: "Invalid skip parameter" });
    }
    const limit = parseInt(url.searchParams.get("limit") ?? "25", 10);
    if (!Number.isFinite(limit) || limit < 1 || limit > 100) {
      return jsonResponse(400, { error: "Invalid limit parameter (1-100)" });
    }
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const status = url.searchParams.get("status");

    try {
      const scope = await resolveCustomerScope(ctx);
      // Empty scope → empty page. Required by spec so admins (no mappings)
      // viewing this surface without impersonation see zero rows.
      if (scope.mappingIds.length === 0) {
        return jsonResponse(200, { items: [], total: 0, skip, limit });
      }

      const conditions = [
        inArray(
          schema.syncedTransactionEvents.userMappingId,
          scope.mappingIds,
        ),
      ];
      if (from) {
        const d = new Date(from);
        if (!Number.isNaN(d.getTime())) {
          conditions.push(gte(schema.syncedTransactionEvents.syncedAt, d));
        }
      }
      if (to) {
        const d = new Date(to);
        if (!Number.isNaN(d.getTime())) {
          d.setHours(23, 59, 59, 999);
          conditions.push(lte(schema.syncedTransactionEvents.syncedAt, d));
        }
      }
      if (status === "completed") {
        conditions.push(eq(schema.syncedTransactionEvents.isFinal, true));
      } else if (status === "active") {
        conditions.push(eq(schema.syncedTransactionEvents.isFinal, false));
      }

      const whereClause = and(...conditions);

      const [{ value: total }] = await db
        .select({ value: count() })
        .from(schema.syncedTransactionEvents)
        .where(whereClause);

      const rows = await db
        .select({
          event: schema.syncedTransactionEvents,
          ocppTag: schema.userMappings.steveOcppIdTag,
        })
        .from(schema.syncedTransactionEvents)
        .leftJoin(
          schema.userMappings,
          eq(
            schema.syncedTransactionEvents.userMappingId,
            schema.userMappings.id,
          ),
        )
        .where(whereClause)
        .orderBy(desc(schema.syncedTransactionEvents.syncedAt))
        .offset(skip)
        .limit(limit);

      // Annotate with estimated cost. Mirrors the page loader's behaviour
      // so paginated pages match the first page.
      const tariff = await resolveCustomerTariff(scope.lagoCustomerExternalId);
      const { from: periodFrom, to: periodTo } = periodWindow("current");
      const periodFromMs = periodFrom.getTime();
      const periodToMs = periodTo.getTime();
      let cumulative = new Map<number, number>();
      if (tariff.tiers.length > 0) {
        const periodRows = await db
          .select({
            id: schema.syncedTransactionEvents.id,
            syncedAt: schema.syncedTransactionEvents.syncedAt,
            kwhDelta: schema.syncedTransactionEvents.kwhDelta,
          })
          .from(schema.syncedTransactionEvents)
          .where(
            and(
              inArray(
                schema.syncedTransactionEvents.userMappingId,
                scope.mappingIds,
              ),
              gte(schema.syncedTransactionEvents.syncedAt, periodFrom),
              lte(schema.syncedTransactionEvents.syncedAt, periodTo),
            ),
          );
        cumulative = buildCumulativeMap(
          periodRows.map((r) => ({
            id: r.id,
            syncedAtMs: r.syncedAt ? new Date(r.syncedAt).getTime() : 0,
            kwh: Number(r.kwhDelta ?? 0),
          })),
        );
      }

      const items = rows.map((r) => {
        const ts = r.event.syncedAt ? r.event.syncedAt.getTime() : 0;
        const estimate = estimateEventCost(
          tariff,
          r.event.id,
          ts,
          Number(r.event.kwhDelta ?? 0),
          cumulative,
          periodFromMs,
          periodToMs,
        );
        return {
          ...r.event,
          ocppTag: r.ocppTag ?? null,
          costCents: estimate.cents,
          costCoverage: estimate.coverage,
        };
      });
      return jsonResponse(200, { items, total, skip, limit });
    } catch (error) {
      log.error("Failed to fetch customer sessions", error as Error);
      return jsonResponse(500, { error: "Failed to fetch sessions" });
    }
  },
});

/**
 * GET /api/customer/usage
 *
 * Returns the customer's current-period usage (kWh, charges, cost) from Lago.
 *
 * Query params:
 *   period — `current` (default), `previous`, `year`. For now we only
 *            implement `current` natively; `previous` / `year` return
 *            `{ usage: null, supported: false, period }` so the UI can
 *            render an "Coming soon" placeholder. Historical usage will
 *            be derived from finalized invoices in a follow-up.
 *
 * Response shape:
 *   { period, usage: LagoCurrentUsage | null, supported: boolean,
 *     subscriptionExternalId, customerExternalId }
 */

import { define } from "../../../utils.ts";
import { db } from "../../../src/db/index.ts";
import * as schema from "../../../src/db/schema.ts";
import { and, eq, isNotNull, ne } from "drizzle-orm";
import { lagoClient } from "../../../src/lib/lago-client.ts";
import { resolveCustomerScope } from "../../../src/lib/scoping.ts";
import { logger } from "../../../src/lib/utils/logger.ts";

const log = logger.child("CustomerUsageAPI");

const ALLOWED_PERIODS = new Set(["current", "previous", "year"] as const);
type Period = "current" | "previous" | "year";

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
    const periodParam = (url.searchParams.get("period") ?? "current") as Period;
    if (!ALLOWED_PERIODS.has(periodParam)) {
      return jsonResponse(400, {
        error: "Invalid period (allowed: current, previous, year)",
      });
    }

    try {
      const scope = await resolveCustomerScope(ctx);
      if (!scope.lagoCustomerExternalId) {
        return jsonResponse(200, {
          period: periodParam,
          usage: null,
          supported: true,
          customerExternalId: null,
          subscriptionExternalId: null,
        });
      }

      // Find the customer's primary subscription via their active mappings.
      // We pick the first non-null subscription id; multi-subscription
      // customers can disambiguate via `?subscription=` later.
      const mappings = await db
        .select({
          subscriptionExternalId:
            schema.userMappings.lagoSubscriptionExternalId,
        })
        .from(schema.userMappings)
        .where(
          and(
            eq(
              schema.userMappings.lagoCustomerExternalId,
              scope.lagoCustomerExternalId,
            ),
            eq(schema.userMappings.isActive, true),
            isNotNull(schema.userMappings.lagoSubscriptionExternalId),
            ne(schema.userMappings.lagoSubscriptionExternalId, ""),
          ),
        );

      const firstSub = mappings[0]?.subscriptionExternalId ?? null;

      if (!firstSub) {
        return jsonResponse(200, {
          period: periodParam,
          usage: null,
          supported: true,
          customerExternalId: scope.lagoCustomerExternalId,
          subscriptionExternalId: null,
        });
      }

      if (periodParam !== "current") {
        // Historical usage requires per-period reconstruction from invoices.
        // Returning a stable shape with `supported=false` lets the UI render
        // a placeholder without polling forever.
        return jsonResponse(200, {
          period: periodParam,
          usage: null,
          supported: false,
          customerExternalId: scope.lagoCustomerExternalId,
          subscriptionExternalId: firstSub,
        });
      }

      const usage = await lagoClient.getCurrentUsage(
        scope.lagoCustomerExternalId,
        firstSub,
      );
      return jsonResponse(200, {
        period: "current",
        usage,
        supported: true,
        customerExternalId: scope.lagoCustomerExternalId,
        subscriptionExternalId: firstSub,
      });
    } catch (error) {
      log.error("Failed to fetch customer usage", error as Error);
      return jsonResponse(502, { error: "Failed to fetch usage" });
    }
  },
});

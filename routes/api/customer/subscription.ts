/**
 * GET /api/customer/subscription
 *
 * Returns the customer's Lago subscription summary: plan name, billing
 * interval, next invoice date, status. Single Lago call (not the admin-wide
 * loop in `/api/admin/subscription`).
 *
 * Empty scope (no Lago link) returns 200 `{ subscription: null }` so the UI
 * can render an "Account not yet linked to billing" hero.
 */

import { define } from "../../../utils.ts";
import { lagoClient } from "../../../src/lib/lago-client.ts";
import { resolveCustomerScope } from "../../../src/lib/scoping.ts";
import { logger } from "../../../src/lib/utils/logger.ts";

const log = logger.child("CustomerSubscriptionAPI");

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

    try {
      const scope = await resolveCustomerScope(ctx);
      if (!scope.lagoCustomerExternalId) {
        return jsonResponse(200, { subscription: null });
      }

      const { subscriptions } = await lagoClient.getSubscriptions(
        scope.lagoCustomerExternalId,
      );

      // Most customers have one active subscription. Pick the first
      // non-terminated row; otherwise the most recent.
      const activeSubscriptions = subscriptions.filter((s) =>
        s.status === "active" || s.status === "pending"
      );
      const sub = activeSubscriptions[0] ?? subscriptions[0] ?? null;

      if (!sub) return jsonResponse(200, { subscription: null });

      return jsonResponse(200, {
        subscription: {
          externalId: sub.external_id,
          name: sub.name ?? sub.plan_code,
          planCode: sub.plan_code,
          status: sub.status,
          billingTime: sub.billing_time,
          subscriptionAt: sub.subscription_at,
          startedAt: sub.started_at,
          endingAt: sub.ending_at,
          terminatedAt: sub.terminated_at,
          previousPlanCode: sub.previous_plan_code,
          nextPlanCode: sub.next_plan_code,
          currentBillingPeriodStartedAt: sub.current_billing_period_started_at,
          currentBillingPeriodEndingAt: sub.current_billing_period_ending_at,
        },
      });
    } catch (error) {
      log.error("Failed to fetch customer subscription", error as Error);
      return jsonResponse(502, { error: "Failed to fetch subscription" });
    }
  },
});

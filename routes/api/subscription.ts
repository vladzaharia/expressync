import { define } from "../../utils.ts";
import { lagoClient } from "../../src/lib/lago-client.ts";
import { logger } from "../../src/lib/utils/logger.ts";

export const handler = define.handlers({
  async GET(_ctx) {
    try {
      const data = await lagoClient.getSubscriptions();

      // Transform to simpler format
      const subscriptions = data.subscriptions.map((s) => ({
        id: s.external_id,
        name: s.name || s.plan_code,
        customerId: s.external_customer_id,
      }));

      return new Response(JSON.stringify(subscriptions), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      logger.error("API", "Failed to fetch subscriptions", error as Error);
      return new Response(
        JSON.stringify({ error: "Failed to fetch subscriptions" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  },
});

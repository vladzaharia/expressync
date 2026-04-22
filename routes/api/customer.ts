import { define } from "../../utils.ts";
import { lagoClient } from "../../src/lib/lago-client.ts";
import { logger } from "../../src/lib/utils/logger.ts";

export const handler = define.handlers({
  async GET(_ctx) {
    try {
      const data = await lagoClient.getCustomers();

      // Transform to simpler format
      const customers = data.customers.map((c) => ({
        id: c.external_id,
        name: c.name || c.external_id,
      }));

      return new Response(JSON.stringify(customers), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      logger.error("API", "Failed to fetch customers", error as Error);
      return new Response(
        JSON.stringify({ error: "Failed to fetch customers" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  },
});

import { define } from "../../../../utils.ts";
import { steveClient } from "../../../../src/lib/steve-client.ts";
import { logger } from "../../../../src/lib/utils/logger.ts";

/**
 * GET /api/charger
 *
 * Returns all charge boxes from StEvE.
 */
export const handler = define.handlers({
  async GET(_ctx) {
    try {
      const chargeBoxes = await steveClient.getChargeBoxes();

      return new Response(
        JSON.stringify({ chargeBoxes }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    } catch (error) {
      logger.error("API", "Failed to fetch charge boxes", error as Error);
      return new Response(
        JSON.stringify({ error: "Failed to fetch charge boxes" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  },
});

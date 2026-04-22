import { define } from "../../../../utils.ts";
import { lagoClient } from "../../../../src/lib/lago-client.ts";
import { logger } from "../../../../src/lib/utils/logger.ts";

/**
 * GET /api/invoice
 *
 * Returns paginated invoices from Lago.
 *
 * Query params:
 * - page: Page number (default: 1)
 * - per_page: Items per page (default: 20)
 */
export const handler = define.handlers({
  async GET(ctx) {
    try {
      const url = new URL(ctx.req.url);
      const page = parseInt(url.searchParams.get("page") ?? "1", 10);
      const perPage = parseInt(url.searchParams.get("per_page") ?? "20", 10);

      if (isNaN(page) || page < 1) {
        return new Response(
          JSON.stringify({ error: "Invalid page parameter" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }
      if (isNaN(perPage) || perPage < 1) {
        return new Response(
          JSON.stringify({ error: "Invalid per_page parameter" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      const result = await lagoClient.getInvoices(page, perPage);

      return new Response(
        JSON.stringify(result),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    } catch (error) {
      logger.error("API", "Failed to fetch invoices", error as Error);
      return new Response(
        JSON.stringify({ error: "Failed to fetch invoices" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  },
});

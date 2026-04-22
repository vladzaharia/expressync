import { define } from "../../../../../utils.ts";
import { lagoClient } from "../../../../../src/lib/lago-client.ts";
import { toInvoiceListDTO } from "../../../../../src/lib/invoice-ui.ts";

/**
 * GET /api/invoice/by-customer/[externalId]?limit=5
 *
 * Cross-surface DTO for the sibling's Tag detail page.
 * Shape (per plan):
 *   {
 *     invoices: Array<InvoiceListDTO>,
 *     totalUnpaidCents: number,
 *     totalPages: number
 *   }
 */
export const handler = define.handlers({
  async GET(ctx) {
    if (!ctx.state.user) {
      return json({ error: "Unauthorized" }, 401);
    }
    const externalId = ctx.params.externalId;
    if (!externalId) return json({ error: "Missing externalId" }, 400);

    const url = new URL(ctx.req.url);
    const limit = Math.min(
      50,
      Math.max(1, parseInt(url.searchParams.get("limit") ?? "5")),
    );

    try {
      const { invoices, meta } = await lagoClient.listInvoices({
        externalCustomerId: externalId,
        perPage: limit,
        page: 1,
      });

      let totalUnpaidCents = 0;
      const rows = invoices.map((inv) => {
        if (
          inv.status === "finalized" &&
          inv.payment_status !== "succeeded"
        ) {
          totalUnpaidCents += inv.total_amount_cents;
        }
        return toInvoiceListDTO(inv);
      });

      return json({
        invoices: rows,
        totalUnpaidCents,
        totalPages: meta?.total_pages ?? 1,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Failed to list invoices by customer", {
        externalId,
        error: message,
      });
      return json({ error: `Failed to list invoices: ${message}` }, 502);
    }
  },
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

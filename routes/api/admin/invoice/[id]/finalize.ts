import { define } from "../../../../../utils.ts";
import { lagoClient } from "../../../../../src/lib/lago-client.ts";
import {
  deriveInvoiceUiStatus,
  toInvoiceListDTO,
} from "../../../../../src/lib/invoice-ui.ts";

/**
 * POST /api/invoice/[id]/finalize
 *
 * Admin-only. Calls Lago `PUT /invoices/:id/finalize` and returns the
 * refreshed invoice in the InvoiceDetail-friendly shape.
 */
export const handler = define.handlers({
  async POST(ctx) {
    if (!ctx.state.user) {
      return json({ error: "Unauthorized" }, 401);
    }
    const id = ctx.params.id;
    if (!id) return json({ error: "Missing invoice id" }, 400);

    try {
      const { invoice } = await lagoClient.finalizeInvoice(id);
      const dto = toInvoiceListDTO(invoice);
      return json({
        ...dto,
        uiStatus: deriveInvoiceUiStatus({
          status: invoice.status,
          payment_status: invoice.payment_status,
          payment_overdue: invoice.payment_overdue,
        }),
        paymentOverdue: Boolean(invoice.payment_overdue),
        feesCents: invoice.fees_amount_cents,
        taxesCents: invoice.taxes_amount_cents,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Failed to finalize invoice", { id, error: message });
      return json({ error: `Failed to finalize invoice: ${message}` }, 502);
    }
  },
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

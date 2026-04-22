import { define } from "../../../../../utils.ts";
import { lagoClient } from "../../../../../src/lib/lago-client.ts";
import {
  deriveInvoiceUiStatus,
  toInvoiceListDTO,
} from "../../../../../src/lib/invoice-ui.ts";

/**
 * POST /api/invoice/[id]/refresh
 *
 * Admin-only. Asks Lago to refresh (recompute) the invoice and returns
 * the latest snapshot. Used both for the explicit "Refresh from Lago"
 * button and for the InvoiceDetail poll loop.
 *
 * For `draft` invoices Lago exposes `PUT /invoices/{id}/refresh`; for
 * already-finalized invoices we simply re-fetch the latest state via
 * `GET /invoices/{id}` — Lago rejects `/refresh` once finalized.
 */
export const handler = define.handlers({
  async POST(ctx) {
    if (!ctx.state.user) {
      return json({ error: "Unauthorized" }, 401);
    }
    const id = ctx.params.id;
    if (!id) return json({ error: "Missing invoice id" }, 400);

    try {
      const current = await lagoClient.getInvoice(id);
      let invoice = current.invoice;
      if (invoice.status === "draft") {
        const refreshed = await lagoClient.refreshInvoice(id);
        invoice = refreshed.invoice;
      }

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
      console.error("Failed to refresh invoice", { id, error: message });
      return json({ error: `Failed to refresh invoice: ${message}` }, 502);
    }
  },
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

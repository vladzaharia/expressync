import { define } from "../../../../../utils.ts";
import { lagoClient } from "../../../../../src/lib/lago-client.ts";
import {
  deriveInvoiceUiStatus,
  toInvoiceListDTO,
} from "../../../../../src/lib/invoice-ui.ts";

/**
 * POST /api/invoice/[id]/void
 *
 * Admin-only. Voids the invoice in Lago. Accepts an optional JSON body
 * `{ generate_credit_note, refund_amount, credit_amount }` which is
 * forwarded as-is (see lago-api.yml InvoiceVoidInput).
 */
export const handler = define.handlers({
  async POST(ctx) {
    if (!ctx.state.user) {
      return json({ error: "Unauthorized" }, 401);
    }
    const id = ctx.params.id;
    if (!id) return json({ error: "Missing invoice id" }, 400);

    let body:
      | {
        generate_credit_note?: boolean;
        refund_amount?: number;
        credit_amount?: number;
      }
      | undefined;
    try {
      if (ctx.req.headers.get("content-type")?.includes("application/json")) {
        body = await ctx.req.json();
      }
    } catch {
      body = undefined;
    }

    try {
      const { invoice } = await lagoClient.voidInvoice(id, body);
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
      console.error("Failed to void invoice", { id, error: message });
      return json({ error: `Failed to void invoice: ${message}` }, 502);
    }
  },
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

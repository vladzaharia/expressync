import { define } from "../../../../../utils.ts";
import { lagoClient } from "../../../../../src/lib/lago-client.ts";
import {
  deriveInvoiceUiStatus,
  extractInvoiceCustomer,
  extractInvoiceSubscription,
} from "../../../../../src/lib/invoice-ui.ts";

/**
 * GET /api/invoice/by-subscription/[externalId]?limit=5
 *
 * Cross-surface DTO for the sibling's Link detail page.
 * Shape (per plan):
 *   {
 *     invoices: Array<{ id, number, status, uiStatus, totalCents, currency,
 *                       issuingDateIso }>,
 *     totalInvoicedLast30dCents: number,
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
        externalSubscriptionId: externalId,
        perPage: limit,
        page: 1,
      });

      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      let totalInvoicedLast30dCents = 0;

      const rows = invoices.map((inv) => {
        const issuedAt = Date.parse(inv.issuing_date);
        if (
          !Number.isNaN(issuedAt) &&
          issuedAt >= thirtyDaysAgo &&
          inv.status === "finalized"
        ) {
          totalInvoicedLast30dCents += inv.total_amount_cents;
        }
        return {
          id: inv.lago_id,
          number: inv.number,
          status: inv.status,
          uiStatus: deriveInvoiceUiStatus({
            status: inv.status,
            payment_status: inv.payment_status,
            payment_overdue: inv.payment_overdue,
          }),
          totalCents: inv.total_amount_cents,
          currency: inv.currency,
          issuingDateIso: inv.issuing_date,
          externalSubscriptionId: extractInvoiceSubscription(inv) ??
            externalId,
          customerName: extractInvoiceCustomer(inv).customerName,
          externalCustomerId: extractInvoiceCustomer(inv).externalCustomerId,
          paymentStatus: inv.payment_status,
          paymentDueDateIso: inv.payment_due_date ?? null,
          payoutOverdue: Boolean(inv.payment_overdue),
          fileUrl: inv.file_url ?? null,
          invoiceType: inv.invoice_type ?? null,
        };
      });

      return json({
        invoices: rows,
        totalInvoicedLast30dCents,
        totalPages: meta?.total_pages ?? 1,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Failed to list invoices by subscription", {
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

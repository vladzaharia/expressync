/**
 * POST /api/customer/invoices/[id]/pdf
 *
 * Trigger Lago's async PDF generation for an invoice the caller owns.
 * Same ownership cross-check as the invoice detail endpoint:
 *   1. `assertOwnership("invoice", id)` — non-empty Lago scope.
 *   2. After the Lago PDF call returns the invoice payload, verify
 *      `external_customer_id` matches.
 *
 * Returns:
 *   200 `{ fileUrl }` when Lago has the PDF ready
 *   202 `{ status: 'pending' }` when generation is still queued — the
 *       client polls `/api/customer/invoices/[id]/refresh` (future) or
 *       re-POSTs after a short delay.
 */

import { define } from "../../../../../utils.ts";
import { lagoClient } from "../../../../../src/lib/lago-client.ts";
import {
  assertOwnership,
  OwnershipError,
  resolveCustomerScope,
} from "../../../../../src/lib/scoping.ts";
import { extractInvoiceCustomer } from "../../../../../src/lib/invoice-ui.ts";
import { logger } from "../../../../../src/lib/utils/logger.ts";

const log = logger.child("CustomerInvoicePdfAPI");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const handler = define.handlers({
  async POST(ctx) {
    if (!ctx.state.user) {
      return jsonResponse(401, { error: "Unauthorized" });
    }
    const id = ctx.params.id;
    if (!id) return jsonResponse(400, { error: "Invalid id" });

    try {
      await assertOwnership(ctx, "invoice", id);
      const scope = await resolveCustomerScope(ctx);

      const result = await lagoClient.downloadInvoicePdf(id);
      const { externalCustomerId } = extractInvoiceCustomer(result.invoice);
      if (
        !externalCustomerId ||
        externalCustomerId !== scope.lagoCustomerExternalId
      ) {
        return jsonResponse(404, { error: "Invoice not found" });
      }

      if (result.invoice.file_url) {
        return jsonResponse(200, { fileUrl: result.invoice.file_url });
      }
      return jsonResponse(202, { status: "pending" });
    } catch (err) {
      if (err instanceof OwnershipError) {
        return jsonResponse(404, { error: "Invoice not found" });
      }
      log.error("Failed to generate invoice PDF", err as Error);
      return jsonResponse(502, { error: "Failed to request PDF" });
    }
  },
});

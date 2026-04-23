/**
 * GET /api/customer/invoices/[id]
 *
 * Single invoice detail. Two ownership checks:
 *   1. `assertOwnership("invoice", id)` — non-empty Lago scope required.
 *   2. After Lago fetch — invoice's `external_customer_id` must equal the
 *      caller's `scope.lagoCustomerExternalId`. Returns 404 on mismatch
 *      (NOT 403 — same anti-enumeration rationale as sessions).
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

const log = logger.child("CustomerInvoiceDetailAPI");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const handler = define.handlers({
  async GET(ctx) {
    if (!ctx.state.user) {
      return jsonResponse(401, { error: "Unauthorized" });
    }
    const id = ctx.params.id;
    if (!id) return jsonResponse(400, { error: "Invalid id" });

    try {
      // Non-empty scope required.
      await assertOwnership(ctx, "invoice", id);

      const scope = await resolveCustomerScope(ctx);
      const { invoice } = await lagoClient.getInvoice(id);
      // Cross-check the actual customer id; defense against ownership-via-typo.
      const { externalCustomerId } = extractInvoiceCustomer(invoice);
      if (
        !externalCustomerId ||
        externalCustomerId !== scope.lagoCustomerExternalId
      ) {
        return jsonResponse(404, { error: "Invoice not found" });
      }

      return jsonResponse(200, { invoice });
    } catch (err) {
      if (err instanceof OwnershipError) {
        return jsonResponse(404, { error: "Invoice not found" });
      }
      log.error("Failed to fetch invoice", err as Error);
      return jsonResponse(502, { error: "Failed to fetch invoice" });
    }
  },
});

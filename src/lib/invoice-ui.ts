import type { LagoInvoice, LagoInvoiceExtended } from "./types/lago.ts";

/**
 * Derived, UI-facing invoice status taxonomy.
 *
 * Combines Lago's `status` + `payment_status` + `payment_overdue`
 * into a single high-signal label we render as chips.
 */
export type InvoiceUiStatus =
  | "draft"
  | "finalized"
  | "paid"
  | "pending"
  | "failed"
  | "overdue"
  | "voided";

export function deriveInvoiceUiStatus(invoice: {
  status: LagoInvoice["status"];
  payment_status: LagoInvoice["payment_status"];
  payment_overdue?: boolean;
}): InvoiceUiStatus {
  if (invoice.status === "draft") return "draft";
  if (invoice.status === "voided") return "voided";
  if (invoice.status === "failed") return "failed";
  if (invoice.status === "pending") return "pending";
  // status === "finalized"
  if (invoice.payment_status === "succeeded") return "paid";
  if (invoice.payment_status === "failed") return "failed";
  if (invoice.payment_overdue) return "overdue";
  return "finalized";
}

/**
 * Shape for compact invoice rows consumed by the Invoices table
 * and the sibling cross-surface endpoints.
 */
export interface InvoiceListDTO {
  id: string;
  number: string;
  status: LagoInvoice["status"];
  paymentStatus: LagoInvoice["payment_status"];
  uiStatus: InvoiceUiStatus;
  totalCents: number;
  currency: string;
  issuingDateIso: string;
  paymentDueDateIso: string | null;
  payoutOverdue: boolean;
  externalCustomerId: string | null;
  customerName: string | null;
  externalSubscriptionId: string | null;
  fileUrl: string | null;
  invoiceType: LagoInvoice["invoice_type"] | null;
}

/**
 * Extract the primary external_customer_id from a Lago invoice payload.
 * `customer` is optional on list responses so we fall back to null.
 */
export function extractInvoiceCustomer(invoice: LagoInvoiceExtended): {
  externalCustomerId: string | null;
  customerName: string | null;
} {
  const customer = invoice.customer as
    | { external_id?: string; name?: string | null }
    | undefined;
  return {
    externalCustomerId: customer?.external_id ?? null,
    customerName: customer?.name ?? null,
  };
}

/**
 * Extract the first external subscription id associated with the invoice.
 */
export function extractInvoiceSubscription(
  invoice: LagoInvoiceExtended,
): string | null {
  const subs = invoice.subscriptions as
    | Array<{ external_id?: string }>
    | undefined;
  if (subs && subs.length > 0 && subs[0]?.external_id) {
    return subs[0].external_id;
  }
  return null;
}

/**
 * Convert a Lago invoice into the compact DTO used by list views + cross-surface APIs.
 */
export function toInvoiceListDTO(
  invoice: LagoInvoiceExtended,
): InvoiceListDTO {
  const { externalCustomerId, customerName } = extractInvoiceCustomer(invoice);
  return {
    id: invoice.lago_id,
    number: invoice.number,
    status: invoice.status,
    paymentStatus: invoice.payment_status,
    uiStatus: deriveInvoiceUiStatus(invoice),
    totalCents: invoice.total_amount_cents,
    currency: invoice.currency,
    issuingDateIso: invoice.issuing_date,
    paymentDueDateIso: invoice.payment_due_date ?? null,
    payoutOverdue: Boolean(invoice.payment_overdue),
    externalCustomerId,
    customerName,
    externalSubscriptionId: extractInvoiceSubscription(invoice),
    fileUrl: invoice.file_url ?? null,
    invoiceType: invoice.invoice_type ?? null,
  };
}

/**
 * Format a cents amount in the invoice's currency using Intl.NumberFormat.
 */
export function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "EUR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    // Fall back to a plain decimal when currency code is unknown.
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

/**
 * Year-Month key used for month-grouping rows in the list view.
 * Returns an ISO-ish `YYYY-MM` string.
 */
export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

/**
 * Format a `YYYY-MM` string as "April 2026" using toLocaleString.
 */
export function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  const d = new Date(Date.UTC(Number(y), Number(m) - 1, 1));
  return d.toLocaleString(undefined, { month: "long", year: "numeric" });
}

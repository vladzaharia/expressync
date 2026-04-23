/**
 * CustomerInvoiceSummary — customer-facing invoice detail.
 *
 * Polaris Track G — read-only counterpart to the admin `InvoiceDetail`.
 * Customers see Summary + Line items but no Finalize / Retry / Void
 * controls. The "View in Lago" link-out is preserved when the operator
 * has wired `LAGO_DASHBOARD_URL`.
 *
 * Uses the canonical `SectionCard` layout with two cards:
 *   - "Summary": MetricTiles for number, date, total, status, period
 *     (period is a cross-link to /sessions filtered by the same date range)
 *   - "Line items": preview of first 3 fees + optional "View all in Lago"
 *
 * The PDF download reuses the admin `InvoicePdfLink` island IF the API
 * route is identical. We expose a parallel customer endpoint at
 * `/api/customer/invoices/[id]/pdf`, so we wrap with our own
 * customer-scoped link variant rather than reuse the admin one (the
 * admin one points at `/api/admin/invoice/...`).
 */

import { useState } from "preact/hooks";
import { toast } from "sonner";
import {
  CalendarRange,
  Download,
  ExternalLink,
  FileText,
  Hash,
  Loader2,
  Receipt,
  Wallet,
} from "lucide-preact";
import { Button } from "@/components/ui/button.tsx";
import { SectionCard } from "@/components/shared/SectionCard.tsx";
import { MetricTile } from "@/components/shared/MetricTile.tsx";
import { InvoiceStatusBadge } from "@/components/shared/InvoiceStatusBadge.tsx";
import { MoneyBadge } from "@/components/billing/MoneyBadge.tsx";
import { formatMoney, type InvoiceUiStatus } from "@/src/lib/invoice-ui.ts";

interface InvoiceLine {
  /** Line item description (Lago `fee.item.name` or similar). */
  label: string;
  /** Optional sublabel — usually the metric / quantity. */
  sublabel?: string;
  /** Cents amount for this line. */
  amountCents: number;
  /** Currency for the line — usually matches the invoice currency. */
  currency: string;
}

export interface CustomerInvoiceSummaryProps {
  invoice: {
    id: string;
    number: string;
    status: "draft" | "finalized" | "voided" | "failed" | "pending";
    paymentStatus: "pending" | "succeeded" | "failed";
    paymentOverdue: boolean;
    uiStatus: InvoiceUiStatus;
    currency: string;
    totalCents: number;
    feesCents: number;
    taxesCents: number;
    issuingDateIso: string;
    paymentDueDateIso: string | null;
    fileUrl: string | null;
    /** Billing period start (e.g. for cross-link to /sessions). */
    periodStartIso: string | null;
    /** Billing period end (for cross-link). */
    periodEndIso: string | null;
    lines: InvoiceLine[];
    /** When the operator has Lago dashboard configured, link out to view all. */
    lagoInvoiceUrl: string | null;
  };
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function buildSessionsHref(
  startIso: string | null,
  endIso: string | null,
): string | null {
  if (!startIso || !endIso) return null;
  const from = startIso.slice(0, 10);
  const to = endIso.slice(0, 10);
  return `/sessions?from=${from}&to=${to}`;
}

/**
 * Customer-scoped PDF download. Mirrors the admin `InvoicePdfLink` polling
 * strategy but talks to `/api/customer/invoices/[id]/pdf` instead.
 */
function CustomerPdfLink(
  { invoiceId, initialFileUrl }: {
    invoiceId: string;
    initialFileUrl: string | null;
  },
) {
  const [fileUrl, setFileUrl] = useState<string | null>(initialFileUrl);
  const [busy, setBusy] = useState(false);

  if (fileUrl) {
    return (
      <Button variant="outline" size="sm" asChild>
        <a
          href={fileUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Download PDF (opens in new tab)"
        >
          <Download className="size-4" aria-hidden="true" />
          Download PDF
        </a>
      </Button>
    );
  }

  const requestPdf = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/customer/invoices/${encodeURIComponent(invoiceId)}/pdf`,
        { method: "POST" },
      );
      if (res.status === 200) {
        const data = await res.json().catch(() => null);
        if (data?.fileUrl) {
          setFileUrl(data.fileUrl);
          globalThis.open(data.fileUrl, "_blank", "noopener,noreferrer");
          return;
        }
      }
      if (res.status === 202) {
        toast.message("PDF is being generated; try again in a moment.");
        return;
      }
      toast.error("Failed to download PDF");
    } catch (err) {
      console.error("CustomerPdfLink error", err);
      toast.error("Failed to download PDF");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={requestPdf}
      disabled={busy}
      aria-label="Generate invoice PDF"
    >
      {busy
        ? <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        : <Download className="size-4" aria-hidden="true" />}
      {busy ? "Generating…" : "Download PDF"}
    </Button>
  );
}

export default function CustomerInvoiceSummary(
  { invoice }: CustomerInvoiceSummaryProps,
) {
  const sessionsHref = buildSessionsHref(
    invoice.periodStartIso,
    invoice.periodEndIso,
  );
  const visibleLines = invoice.lines.slice(0, 3);
  const remainingLines = invoice.lines.length - visibleLines.length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <CustomerPdfLink
          invoiceId={invoice.id}
          initialFileUrl={invoice.fileUrl}
        />
        {invoice.lagoInvoiceUrl && (
          <Button variant="outline" size="sm" asChild>
            <a
              href={invoice.lagoInvoiceUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="View in Lago (opens in new tab)"
            >
              <ExternalLink className="size-4" aria-hidden="true" />
              View in Lago
            </a>
          </Button>
        )}
      </div>

      <SectionCard title="Summary" icon={Receipt} accent="teal">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <MetricTile
            icon={Hash}
            label="Invoice"
            value={<span className="font-mono">{invoice.number}</span>}
            accent="teal"
          />
          <MetricTile
            icon={CalendarRange}
            label="Issued"
            value={formatDate(invoice.issuingDateIso)}
            sublabel={invoice.paymentDueDateIso
              ? `Due ${formatDate(invoice.paymentDueDateIso)}`
              : undefined}
            accent="teal"
          />
          <MetricTile
            icon={Wallet}
            label="Total"
            value={
              <MoneyBadge
                cents={invoice.totalCents}
                currency={invoice.currency}
              />
            }
            sublabel={invoice.taxesCents > 0
              ? `Taxes ${formatMoney(invoice.taxesCents, invoice.currency)}`
              : undefined}
            accent="teal"
          />
          <MetricTile
            icon={FileText}
            label="Status"
            value={<InvoiceStatusBadge status={invoice.uiStatus} />}
            accent="teal"
          />
          <MetricTile
            icon={CalendarRange}
            label="Period"
            value={sessionsHref
              ? (
                <a
                  href={sessionsHref}
                  className="text-teal-600 dark:text-teal-400 hover:underline"
                >
                  {formatDate(invoice.periodStartIso)} →{" "}
                  {formatDate(invoice.periodEndIso)}
                </a>
              )
              : (invoice.periodStartIso
                ? `${formatDate(invoice.periodStartIso)} → ${
                  formatDate(invoice.periodEndIso)
                }`
                : "—")}
            sublabel={sessionsHref ? "View sessions" : undefined}
            accent="teal"
          />
        </div>
      </SectionCard>

      <SectionCard title="Line items" icon={FileText} accent="teal">
        {visibleLines.length === 0
          ? (
            <p className="text-sm text-muted-foreground">
              No line items on this invoice yet.
            </p>
          )
          : (
            <ul className="divide-y rounded-md border">
              {visibleLines.map((line, idx) => (
                <li
                  key={idx}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{line.label}</p>
                    {line.sublabel && (
                      <p className="truncate text-xs text-muted-foreground">
                        {line.sublabel}
                      </p>
                    )}
                  </div>
                  <MoneyBadge
                    cents={line.amountCents}
                    currency={line.currency}
                  />
                </li>
              ))}
            </ul>
          )}
        {(remainingLines > 0 || invoice.lagoInvoiceUrl) && (
          <p className="mt-3 text-xs text-muted-foreground">
            {remainingLines > 0 && (
              <span>
                {remainingLines} more line item{remainingLines !== 1 ? "s" : ""}
                {" "}
                not shown.
                {" "}
              </span>
            )}
            {invoice.lagoInvoiceUrl && (
              <a
                href={invoice.lagoInvoiceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-teal-600 dark:text-teal-400 hover:underline"
              >
                View all in Lago
                <ExternalLink className="size-3" aria-hidden="true" />
              </a>
            )}
          </p>
        )}
      </SectionCard>
    </div>
  );
}

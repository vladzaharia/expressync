/**
 * CustomerInvoicesTable — customer-scoped invoices list.
 *
 * Polaris Track G — wraps `PaginatedTable` in mobile-card mode so the same
 * table renders as a stacked card list on `<md` viewports. Mirrors the
 * admin `InvoicesTable` shape but slimmed down — customers don't see the
 * customer chip column (the rows ARE the customer's own).
 *
 * Desktop columns:
 *   Date · Number · Amount · Status
 *
 * Mobile card layout:
 *   topLeft       = issuing date
 *   topRight      = InvoiceStatusBadge
 *   secondaryLine = invoice number (monospace)
 *   primaryStat   = MoneyBadge total
 *   secondaryStat = invoice period (when known)
 */

import { MoneyBadge } from "@/components/billing/MoneyBadge.tsx";
import { InvoiceStatusBadge } from "@/components/shared/InvoiceStatusBadge.tsx";
import { MobileCardRow } from "@/components/shared/MobileCardRow.tsx";
import {
  PaginatedTable,
  type PaginatedTableColumn,
} from "@/components/ui/paginated-table.tsx";
import type { InvoiceListDTO } from "@/src/lib/invoice-ui.ts";
import { clientNavigate } from "@/src/lib/nav.ts";

interface Props {
  invoices: InvoiceListDTO[];
  totalCount?: number;
  pageSize?: number;
  /** API endpoint for "Load more" pagination. */
  fetchUrl?: string;
  /** Active filters merged into every fetch (preserved across pages). */
  fetchParams?: Record<string, string>;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function CustomerInvoicesTable(
  { invoices, totalCount, pageSize = 25, fetchUrl, fetchParams }: Props,
) {
  const columns: PaginatedTableColumn<InvoiceListDTO>[] = [
    {
      key: "date",
      header: "Date",
      render: (row) => (
        <span className="text-sm text-muted-foreground">
          {formatDate(row.issuingDateIso)}
        </span>
      ),
    },
    {
      key: "number",
      header: "Number",
      render: (row) => <span className="font-mono text-sm">{row.number}</span>,
    },
    {
      key: "amount",
      header: "Amount",
      className: "text-right",
      render: (row) => (
        <MoneyBadge cents={row.totalCents} currency={row.currency} />
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <InvoiceStatusBadge status={row.uiStatus} />,
    },
  ];

  const renderMobileCard = (row: InvoiceListDTO) => (
    <MobileCardRow
      topLeft={formatDate(row.issuingDateIso)}
      topRight={<InvoiceStatusBadge status={row.uiStatus} />}
      secondaryLine={<span className="font-mono">{row.number}</span>}
      primaryStat={
        <MoneyBadge cents={row.totalCents} currency={row.currency} />
      }
      secondaryStat={row.paymentDueDateIso
        ? `Due ${formatDate(row.paymentDueDateIso)}`
        : undefined}
    />
  );

  return (
    <PaginatedTable<InvoiceListDTO>
      initialItems={invoices}
      columns={columns}
      totalCount={totalCount}
      pageSize={pageSize}
      fetchUrl={fetchUrl}
      fetchParams={fetchParams}
      getItemKey={(row) => row.id}
      onRowClick={(row) => {
        clientNavigate(`/billing/invoices/${encodeURIComponent(row.id)}`);
      }}
      emptyMessage="No invoices match the current filters"
      renderMobileCard={renderMobileCard}
    />
  );
}

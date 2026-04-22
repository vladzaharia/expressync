import { useMemo } from "preact/hooks";
import { BlurFade } from "@/components/magicui/blur-fade.tsx";
import { InvoiceStatusChip } from "@/components/billing/InvoiceStatusChip.tsx";
import { MoneyBadge } from "@/components/billing/MoneyBadge.tsx";
import { InvoiceNumberLink } from "@/components/billing/InvoiceNumberLink.tsx";
import { CustomerChip } from "@/components/billing/CustomerChip.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.tsx";
import { GridPattern } from "@/components/magicui/grid-pattern.tsx";
import { FileText } from "lucide-preact";
import {
  type InvoiceListDTO,
  monthKey,
  monthLabel,
} from "@/src/lib/invoice-ui.ts";

interface Props {
  invoices: InvoiceListDTO[];
  lagoDashboardUrl?: string;
  /** lago_id keyed by external_customer_id, used to build outbound Lago URLs */
  customerLagoIds?: Record<string, string>;
}

export default function InvoicesTable({
  invoices,
  lagoDashboardUrl,
  customerLagoIds,
}: Props) {
  const grouped = useMemo(() => groupByMonth(invoices), [invoices]);

  if (invoices.length === 0) {
    return (
      <div
        role="region"
        aria-label="Invoices empty state"
        className="relative overflow-hidden rounded-lg border border-dashed py-16 text-center"
      >
        <GridPattern
          width={24}
          height={24}
          className="absolute inset-0 -z-10 opacity-[0.025]"
        />
        <FileText
          className="size-8 mx-auto mb-3 text-muted-foreground"
          aria-hidden="true"
        />
        <p className="text-sm font-medium">No invoices match these filters</p>
        <p className="text-xs text-muted-foreground mt-1">
          Try clearing filters or widening the date range
        </p>
      </div>
    );
  }

  return (
    <div
      role="region"
      aria-label="Invoices list"
      tabIndex={0}
      className="overflow-x-auto"
    >
      <div className="space-y-6">
        {grouped.map((group, groupIndex) => (
          <BlurFade
            key={group.key}
            delay={groupIndex * 0.04}
            direction="up"
            duration={0.35}
          >
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group.label}
              </h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Number</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="hidden md:table-cell">
                      Issued
                    </TableHead>
                    <TableHead className="hidden md:table-cell">
                      Due
                    </TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.rows.map((row) => (
                    <TableRow
                      key={row.id}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => {
                        globalThis.location.href = `/invoices/${
                          encodeURIComponent(row.id)
                        }`;
                      }}
                    >
                      <TableCell>
                        <InvoiceNumberLink id={row.id} number={row.number} />
                      </TableCell>
                      <TableCell>
                        <CustomerChip
                          externalId={row.externalCustomerId}
                          name={row.customerName}
                          lagoDashboardUrl={lagoDashboardUrl}
                          lagoId={row.externalCustomerId &&
                              customerLagoIds?.[row.externalCustomerId]
                            ? customerLagoIds[row.externalCustomerId]
                            : null}
                        />
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                        {formatDate(row.issuingDateIso)}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                        {row.paymentDueDateIso
                          ? formatDate(row.paymentDueDateIso)
                          : "—"}
                      </TableCell>
                      <TableCell>
                        <InvoiceStatusChip status={row.uiStatus} />
                      </TableCell>
                      <TableCell className="text-right">
                        <MoneyBadge
                          cents={row.totalCents}
                          currency={row.currency}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </BlurFade>
        ))}
      </div>
    </div>
  );
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

function groupByMonth(
  rows: InvoiceListDTO[],
): Array<{ key: string; label: string; rows: InvoiceListDTO[] }> {
  const groups = new Map<string, InvoiceListDTO[]>();
  for (const row of rows) {
    const key = monthKey(row.issuingDateIso);
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  return Array.from(groups.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, items]) => ({
      key,
      label: monthLabel(key),
      rows: items,
    }));
}

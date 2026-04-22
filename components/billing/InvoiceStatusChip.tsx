/**
 * InvoiceStatusChip — thin re-export over `InvoiceStatusBadge`.
 *
 * Kept as a separate module so existing consumers importing
 * `InvoiceStatusChip` continue to work unchanged. Visual styling now lives in
 * `components/shared/InvoiceStatusBadge.tsx` on top of the canonical
 * `<StatusBadge>` primitive.
 */

import { InvoiceStatusBadge } from "@/components/shared/InvoiceStatusBadge.tsx";
import type { InvoiceUiStatus } from "@/src/lib/invoice-ui.ts";

interface Props {
  status: InvoiceUiStatus;
  /**
   * When true render as an outlined chip (cross-surface reference).
   * When false render a filled chip (own-domain: the Invoices surface).
   */
  outlined?: boolean;
  className?: string;
}

export function InvoiceStatusChip(
  { status, outlined = false, className }: Props,
) {
  return (
    <InvoiceStatusBadge
      status={status}
      outlined={outlined}
      className={className}
    />
  );
}

export { InvoiceStatusBadge };

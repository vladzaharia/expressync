/**
 * ReservationStatusChip — thin re-export over `ReservationStatusBadge`.
 *
 * Kept as a separate module so existing consumers importing
 * `ReservationStatusChip` continue to work unchanged. The visual is now
 * driven by the canonical `<StatusBadge>` primitive via
 * `components/shared/ReservationStatusBadge.tsx`.
 */

import { ReservationStatusBadge } from "@/components/shared/ReservationStatusBadge.tsx";
import type { ReservationStatus } from "@/src/db/schema.ts";

interface Props {
  status: ReservationStatus;
  class?: string;
  /** When true, renders the chip with a slightly larger footprint. */
  large?: boolean;
}

export function ReservationStatusChip(
  { status, class: className, large }: Props,
) {
  return (
    <ReservationStatusBadge
      status={status}
      className={className}
      large={large}
    />
  );
}

export { ReservationStatusBadge };

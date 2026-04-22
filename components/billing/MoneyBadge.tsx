import { cn } from "@/src/lib/utils/cn.ts";
import { formatMoney } from "@/src/lib/invoice-ui.ts";

interface Props {
  cents: number;
  currency: string;
  /** Muted styling for zero or draft amounts */
  muted?: boolean;
  className?: string;
}

/**
 * Tabular-aligned currency rendering for invoice lists and detail cards.
 */
export function MoneyBadge({ cents, currency, muted, className }: Props) {
  return (
    <span
      className={cn(
        "font-medium tabular-nums",
        muted && "text-muted-foreground",
        className,
      )}
    >
      {formatMoney(cents, currency)}
    </span>
  );
}

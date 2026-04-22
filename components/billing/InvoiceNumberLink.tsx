import { FileText } from "lucide-preact";
import { cn } from "@/src/lib/utils/cn.ts";

interface Props {
  id: string;
  number: string;
  className?: string;
}

/**
 * Monospace invoice number that links to the detail page.
 * Leading teal icon marks it as belonging to the Invoices surface.
 */
export function InvoiceNumberLink({ id, number, className }: Props) {
  return (
    <a
      href={`/invoices/${encodeURIComponent(id)}`}
      className={cn(
        "inline-flex items-center gap-1.5 font-mono text-sm text-teal-600 dark:text-teal-400 hover:underline",
        className,
      )}
    >
      <FileText className="size-3.5 shrink-0" aria-hidden="true" />
      {number}
    </a>
  );
}

import { User } from "lucide-preact";
import { Badge } from "@/components/ui/badge.tsx";
import { cn } from "@/src/lib/utils/cn.ts";

interface Props {
  externalId: string | null;
  name: string | null;
  /** When provided, clicking the chip opens the customer in Lago (new tab). */
  lagoDashboardUrl?: string;
  lagoId?: string | null;
  className?: string;
}

/**
 * Outlined chip for cross-domain customer references.
 * Per plan: cross-domain references render as outlined chips with the
 * destination accent border (violet/cyan depending on surface).
 */
export function CustomerChip({
  externalId,
  name,
  lagoDashboardUrl,
  lagoId,
  className,
}: Props) {
  const label = name ?? externalId ?? "Unknown";
  const href = lagoDashboardUrl && lagoId
    ? `${lagoDashboardUrl}/customers/${encodeURIComponent(lagoId)}`
    : undefined;

  const content = (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 border-violet-500/40 text-violet-700 dark:text-violet-300",
        className,
      )}
    >
      <User className="size-3 shrink-0" aria-hidden="true" />
      <span className="truncate max-w-[16ch]">{label}</span>
    </Badge>
  );

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${label} (opens in new tab)`}
        className="inline-block"
      >
        {content}
      </a>
    );
  }

  return content;
}

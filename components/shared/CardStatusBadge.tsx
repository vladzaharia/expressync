/**
 * CardStatusBadge — domain-specific StatusBadge wrapper for customer cards.
 *
 * Cards == OCPP tags. The customer surface treats `userMappings.isActive`
 * as the canonical "card live" indicator:
 *   - active   → success tone + CheckCircle2 (the card can start sessions)
 *   - inactive → muted tone + XCircle (the operator has paused or revoked it)
 *
 * Mirrors `TransactionStatusBadge` in shape so the rest of the customer
 * surface can swap badges without learning a new prop API. Used in the
 * `/cards` grid, `/cards/[id]` header, and as a cross-link affordance from
 * the session detail page.
 */

import { CheckCircle2, XCircle } from "lucide-preact";
import { StatusBadge, type StatusBadgeTone } from "./StatusBadge.tsx";

interface Props {
  isActive: boolean;
  large?: boolean;
  className?: string;
}

const ICON_CLASS = "size-3";

const ACTIVE_MAP: {
  tone: StatusBadgeTone;
  label: string;
  icon: preact.JSX.Element;
} = {
  tone: "success",
  label: "Active",
  icon: <CheckCircle2 class={ICON_CLASS} />,
};

const INACTIVE_MAP: {
  tone: StatusBadgeTone;
  label: string;
  icon: preact.JSX.Element;
} = {
  tone: "muted",
  label: "Inactive",
  icon: <XCircle class={ICON_CLASS} />,
};

export function CardStatusBadge({ isActive, large, className }: Props) {
  const { tone, label, icon } = isActive ? ACTIVE_MAP : INACTIVE_MAP;
  return (
    <StatusBadge
      tone={tone}
      icon={icon}
      label={label}
      large={large}
      className={className}
    />
  );
}

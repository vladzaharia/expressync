/**
 * EmptyStateContact — variant of `EmptyState` whose primary action is
 * always "Contact operator" (mailto:OPERATOR_CONTACT_EMAIL). Used when a
 * customer surface is empty AND the appropriate next step is to ask the
 * operator (e.g. "No cards linked yet — contact your operator to get one").
 *
 * Wraps the canonical `EmptyState`; pass `operatorEmail` from a server
 * loader (the env var is server-side only, so islands receive it as a
 * prop). Falls back to a `mailto:` with no recipient if the env var isn't
 * configured — the user's mail client will still open and they can address
 * it themselves.
 */

import type { LucideIcon } from "lucide-preact";
import { Mail } from "lucide-preact";
import {
  EmptyState,
  type EmptyStateAction,
} from "@/components/shared/EmptyState.tsx";
import type { AccentColor } from "@/src/lib/colors.ts";

interface EmptyStateContactProps {
  icon?: LucideIcon;
  title: string;
  description: string;
  /** Operator contact email — pass from server (`OPERATOR_CONTACT_EMAIL`). */
  operatorEmail?: string;
  /** Optional subject line for the mailto link. */
  subject?: string;
  /** Optional secondary action (e.g. a help-doc link). */
  secondaryAction?: EmptyStateAction;
  accent?: AccentColor;
}

export function EmptyStateContact({
  icon,
  title,
  description,
  operatorEmail,
  subject,
  secondaryAction,
  accent = "cyan",
}: EmptyStateContactProps) {
  const mailto = operatorEmail
    ? `mailto:${operatorEmail}${
      subject ? `?subject=${encodeURIComponent(subject)}` : ""
    }`
    : "mailto:";

  return (
    <EmptyState
      icon={icon}
      title={title}
      description={description}
      accent={accent}
      primaryAction={{
        label: "Contact operator",
        href: mailto,
        icon: Mail,
        ariaLabel: operatorEmail
          ? `Email ${operatorEmail}`
          : "Email your operator",
      }}
      secondaryAction={secondaryAction}
    />
  );
}

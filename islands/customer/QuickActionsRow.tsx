/**
 * QuickActionsRow — 4 large iconed buttons rendered in the dashboard's
 * "Quick actions" SectionCard.
 *
 *   Reserve · Scan to start · View invoices · My cards
 *
 * Layout: 2×2 grid on mobile, single horizontal flex row on desktop.
 *
 * Inactive accounts: every action except "Cards" is shown disabled with a
 * tooltip "Account inactive — contact your operator". Cards stays
 * enabled because it's view-only by definition (no remote side-effects).
 */

import { CalendarPlus, CreditCard, Receipt, ScanLine } from "lucide-preact";
import { QuickActionButton } from "@/components/shared/QuickActionButton.tsx";

interface Props {
  isActive: boolean;
}

export default function QuickActionsRow({ isActive }: Props) {
  const disabledReason = isActive
    ? undefined
    : "Account inactive — contact your operator.";

  return (
    <div class="grid grid-cols-2 gap-3 md:flex md:flex-wrap md:gap-3">
      <div class="md:flex-1" data-tour="reserve">
        <QuickActionButton
          icon={CalendarPlus}
          label="Reserve"
          subtext="Book ahead"
          href={isActive ? "/reservations/new" : undefined}
          disabled={!isActive}
          disabledReason={disabledReason}
          accent="indigo"
        />
      </div>
      <div class="md:flex-1">
        <QuickActionButton
          icon={ScanLine}
          label="Scan to start"
          subtext="Tap your card"
          href={isActive ? "/login/scan" : undefined}
          disabled={!isActive}
          disabledReason={disabledReason}
          accent="cyan"
        />
      </div>
      <div class="md:flex-1">
        <QuickActionButton
          icon={Receipt}
          label="Invoices"
          subtext="Past charges"
          href="/billing"
          accent="teal"
        />
      </div>
      <div class="md:flex-1" data-tour="cards">
        <QuickActionButton
          icon={CreditCard}
          label="My cards"
          subtext="Manage tags"
          href="/cards"
          accent="cyan"
        />
      </div>
    </div>
  );
}

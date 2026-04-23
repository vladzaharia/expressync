/**
 * Polaris Track G2 — grid of the customer's cards (== tags).
 *
 * Per plan: "for cards we keep a card-grid layout, NOT a paginated table
 * (small N per customer; cards-as-cards is more visual)." Each tile is a
 * `SectionCard accent="cyan"` with:
 *   - large CreditCard icon (form-factor placeholder for v1)
 *   - display name (or OCPP tag id fallback)
 *   - last-used relative time
 *   - status badge (CardStatusBadge)
 *   - tap → /cards/[id]
 *
 * 1 col mobile, 2 cols sm, 3 cols lg — leans on Tailwind grid breakpoints.
 *
 * The whole tile is clickable (anchor wraps the SectionCard) so the row
 * scans as tappable on mobile and respects keyboard activation.
 */

import { CreditCard } from "lucide-preact";
import { CardStatusBadge } from "@/components/shared/index.ts";
import { SectionCard } from "@/components/shared/SectionCard.tsx";
import { formatRelative } from "@/islands/shared/charger-visuals.ts";

export interface CustomerCard {
  id: number;
  displayName: string | null;
  ocppTagId: string;
  ocppTagPk: number;
  tagType: string;
  isActive: boolean;
  createdAt: string | null;
  sessionCount: number;
  lastUsedAt: string | null;
  totalKwh: number;
}

interface Props {
  cards: CustomerCard[];
}

export default function CustomerCardList({ cards }: Props) {
  return (
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {cards.map((card) => {
        const name = card.displayName?.trim() || card.ocppTagId;
        const lastUsed = card.lastUsedAt
          ? formatRelative(card.lastUsedAt)
          : "Never used";
        return (
          <a
            key={card.id}
            href={`/cards/${card.id}`}
            class="block rounded-xl transition-transform motion-safe:hover:scale-[1.01] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <SectionCard
              title={name}
              description={card.ocppTagId !== name ? card.ocppTagId : undefined}
              icon={CreditCard}
              accent="cyan"
              actions={<CardStatusBadge isActive={card.isActive} />}
            >
              <div class="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p class="text-xs text-muted-foreground">Sessions</p>
                  <p class="font-semibold tabular-nums">{card.sessionCount}</p>
                </div>
                <div>
                  <p class="text-xs text-muted-foreground">kWh delivered</p>
                  <p class="font-semibold tabular-nums">
                    {card.totalKwh.toFixed(2)}
                  </p>
                </div>
                <div class="col-span-2">
                  <p class="text-xs text-muted-foreground">Last used</p>
                  <p class="font-medium">{lastUsed}</p>
                </div>
              </div>
            </SectionCard>
          </a>
        );
      })}
    </div>
  );
}

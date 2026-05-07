/**
 * One card in the Privacy / ToS stack.
 *
 * Visible content:
 *   - Lucide icon in an accent-tinted bubble (left)
 *   - Title (h2)
 *   - Plain-English summary in slightly muted text (always visible)
 *   - Body paragraph(s) below
 *   - Optional bullet list
 *
 * Anchor: the wrapper sets `id={card.id}` so deep links like
 * `/privacy#charging-activity` jump straight to the card.
 *
 * Icons are looked up dynamically from a fixed allow-list — the runtime
 * union of every Lucide name referenced in the legal data files. Adding a
 * new icon requires touching this file too, which is the whole point: it
 * keeps the icon set predictable and tree-shakes the rest of Lucide out.
 */

import {
  AlertTriangle,
  BadgeCheck,
  Ban,
  Bell,
  CalendarClock,
  CreditCard,
  Database,
  FileLock,
  FileSignature,
  Gavel,
  Globe,
  Handshake,
  type LucideIcon,
  MailOpen,
  Scale,
  ScrollText,
  Shield,
  ShieldAlert,
  Smartphone,
  Trash2,
  UserCheck,
  Users,
  Zap,
} from "lucide-preact";
import { Card, CardContent } from "@/components/ui/card.tsx";
import { cn } from "@/src/lib/utils/cn.ts";
import type { LegalCard as LegalCardData } from "@/src/lib/legal/types.ts";

const ICONS: Record<string, LucideIcon> = {
  AlertTriangle,
  BadgeCheck,
  Ban,
  Bell,
  CalendarClock,
  CreditCard,
  Database,
  FileLock,
  FileSignature,
  Gavel,
  Globe,
  Handshake,
  MailOpen,
  Scale,
  ScrollText,
  Shield,
  ShieldAlert,
  Smartphone,
  Trash2,
  UserCheck,
  Users,
  Zap,
};

interface Props {
  card: LegalCardData;
  /** When true, the card is rendered with an extra-prominent accent ring;
   *  used for the Terms agreement gate. */
  emphasis?: boolean;
}

export function LegalCard({ card, emphasis = false }: Props) {
  const Icon = ICONS[card.icon] ?? Shield;
  return (
    <Card
      id={card.id}
      class={cn(
        "scroll-mt-24",
        emphasis && "border-primary/40 ring-1 ring-primary/20",
      )}
    >
      <CardContent class="flex flex-col gap-3 px-6 py-5 sm:flex-row sm:gap-5">
        <div
          class={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-lg",
            emphasis
              ? "bg-primary/15 text-primary"
              : "bg-primary/10 text-primary",
          )}
          aria-hidden="true"
        >
          <Icon class="size-5" />
        </div>
        <div class="flex-1 space-y-3">
          <header class="space-y-1">
            <h2 class="text-base font-semibold leading-tight">
              <a
                href={`#${card.id}`}
                class="no-underline hover:underline focus-visible:underline"
              >
                {card.title}
              </a>
            </h2>
            <p class="text-sm text-muted-foreground">{card.summary}</p>
          </header>
          <div class="space-y-3 text-sm leading-relaxed">
            {card.body.split(/\n\n+/).map((para, i) => <p key={i}>{para}</p>)}
            {card.bullets && card.bullets.length > 0
              ? (
                <ul class="list-disc space-y-1 pl-5 text-sm">
                  {card.bullets.map((b) => <li key={b}>{b}</li>)}
                </ul>
              )
              : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

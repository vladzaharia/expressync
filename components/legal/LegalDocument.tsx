/**
 * Page-level wrapper for legal documents. Renders effective-date metadata,
 * an in-page table of contents, and the stack of cards.
 *
 * The document is rendered inside a `PageCard` by the calling route; this
 * component lays out only the contents (no SidebarLayout, no chrome).
 */

import { LegalCard } from "./LegalCard.tsx";
import type {
  LegalCard as LegalCardData,
  LegalDocumentMeta,
} from "@/src/lib/legal/types.ts";

interface Props {
  meta: LegalDocumentMeta;
  cards: LegalCardData[];
  /** Optional ID of a card to render with extra emphasis at the top of the
   *  stack (the Terms "agreement gate"). When set, the card is removed
   *  from the regular sequence and rendered above the rest with an accent
   *  ring. */
  emphasizedCardId?: string;
}

export function LegalDocument({ meta, cards, emphasizedCardId }: Props) {
  const gate = emphasizedCardId
    ? cards.find((c) => c.id === emphasizedCardId)
    : undefined;
  const rest = gate ? cards.filter((c) => c.id !== gate.id) : cards;
  const formattedDate = new Date(meta.effectiveDate).toLocaleDateString(
    "en-US",
    { year: "numeric", month: "long", day: "numeric" },
  );

  return (
    <div class="flex flex-col gap-6">
      {/* Meta strip */}
      <div class="flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6">
        <span>
          Effective <strong class="text-foreground">{formattedDate}</strong>
        </span>
        <span>
          Questions:{" "}
          <a
            class="text-primary hover:underline"
            href={`mailto:${meta.contactEmail}`}
          >
            {meta.contactEmail}
          </a>
        </span>
      </div>

      {/* Table of contents — anchor links to each card */}
      <nav
        aria-label={`${meta.title} sections`}
        class="rounded-lg border bg-muted/40 p-4"
      >
        <p class="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Jump to a section
        </p>
        <ol class="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {cards.map((c, i) => (
            <li key={c.id} class="flex gap-2">
              <span class="text-muted-foreground tabular-nums w-6 shrink-0">
                {String(i + 1).padStart(2, "0")}
              </span>
              <a
                class="text-primary hover:underline focus-visible:underline"
                href={`#${c.id}`}
              >
                {c.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      {/* Cards */}
      <div class="flex flex-col gap-4">
        {gate ? <LegalCard card={gate} emphasis /> : null}
        {rest.map((c) => <LegalCard key={c.id} card={c} />)}
      </div>
    </div>
  );
}

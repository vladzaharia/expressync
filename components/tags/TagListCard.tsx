/**
 * TagListCard — one card in the `/tags` grid.
 *
 * Visual vocabulary is anchored on `TagHeaderStrip` but compressed to fit in
 * a 3-4 column grid. Sections, top-to-bottom:
 *
 *   1. Top row
 *      - `size-10` icon pill (form-factor tint for normal tags; dashed
 *        violet well with `<Layers />` for meta-tags).
 *      - Column with uppercase type label + mono idTag (truncated).
 *      - Right-aligned quick-action icon link, visible on hover/focus.
 *        Linked tags get `<CreditCard />` → `#issue-card` on detail page.
 *        Unlinked tags get `<Link2 />` → `/links/new?tagPk=:pk`.
 *
 *   2. Middle
 *      - `<p>` display name or italic "No display name".
 *      - `<p>` notes (clamped to 2 lines).
 *
 *   3. Bottom
 *      - `CornerDownRight` + parent idTag (only if present).
 *      - Right-aligned `BarePills` row carrying Meta / Unlinked|Linked /
 *        Inactive / Cards: N.
 *
 * Implementation note on nav/click targets:
 *   Nested `<a>` tags are invalid HTML, so we use the "card stretched link"
 *   pattern. The card root is a `<div>`; a full-bleed absolutely-positioned
 *   anchor provides the primary `aria-label`-ed navigation target. The
 *   quick-action link sits on a higher stacking context (`relative z-10`)
 *   so it wins click-dispatch. Keyboard focus travels to both, and the
 *   card's `focus-within` ring covers either.
 */

import type { ComponentChildren } from "preact";
import { CornerDownRight, CreditCard, Layers, Link2 } from "lucide-preact";
import { cn } from "@/src/lib/utils/cn.ts";
import { type Pill, StatusPillRow } from "@/components/tags/StatusPillRow.tsx";
import { tagTypeIcons } from "@/components/brand/tags/index.ts";
import {
  TAG_TYPES,
  type TagType,
  tagTypeLabels,
} from "@/src/lib/types/tags.ts";
import { tagTypeBgClass, tagTypeTextClass } from "@/src/lib/tag-visuals.ts";

export interface TagListCardProps {
  ocppTagPk: number;
  idTag: string;
  parentIdTag: string | null;
  displayName: string | null;
  tagType: string | null;
  notes: string | null;
  isActive: boolean;
  isMeta: boolean;
  hasLagoCustomer: boolean;
}

function coerceTagType(value: string | null | undefined): TagType {
  return value && (TAG_TYPES as readonly string[]).includes(value)
    ? (value as TagType)
    : "other";
}

export function TagListCard(props: TagListCardProps) {
  const {
    ocppTagPk,
    idTag,
    parentIdTag,
    displayName,
    tagType,
    notes,
    isActive,
    isMeta,
    hasLagoCustomer,
  } = props;

  const tt = coerceTagType(tagType);
  const Icon = isMeta ? null : tagTypeIcons[tt];
  const typeLabel = isMeta ? "Meta-tag" : tagTypeLabels[tt];

  const pills: Pill[] = [];
  if (isMeta) {
    pills.push({
      label: "Meta",
      tone: "violet",
      dashed: true,
      title: "OCPP-* tags are hierarchy rollups, not physical cards.",
    });
  }
  pills.push(
    hasLagoCustomer
      ? { label: "Linked", tone: "cyan" }
      : { label: "Unlinked", tone: "amber", dashed: true },
  );
  if (!isActive) {
    pills.push({
      label: "Inactive",
      tone: "muted",
      dashed: true,
      live: true,
    });
  }
  const quickAction = buildQuickAction({
    ocppTagPk,
    hasLagoCustomer,
    isMeta,
    isActive,
  });

  const ariaLabel = `Tag ${idTag}${displayName ? ` — ${displayName}` : ""}`;

  return (
    <div
      data-meta={isMeta ? "true" : undefined}
      data-inactive={!isActive ? "true" : undefined}
      class={cn(
        "group relative flex h-full flex-col gap-3 rounded-lg border-2 bg-card p-4",
        "transition-colors hover:border-cyan-500/70",
        "focus-within:border-cyan-500/70 focus-within:ring-2 focus-within:ring-ring",
        "data-[meta=true]:border-dashed data-[meta=true]:bg-violet-500/5",
        "data-[inactive=true]:opacity-60",
      )}
    >
      {/* Stretched primary link — covers the whole card. */}
      <a
        href={`/tags/${ocppTagPk}`}
        aria-label={ariaLabel}
        class="absolute inset-0 rounded-lg focus:outline-none"
      >
        <span class="sr-only">{ariaLabel}</span>
      </a>

      {/* Top row: icon + type/idTag + hover quick-action */}
      <div class="pointer-events-none relative flex items-start gap-3">
        <div
          class={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-lg",
            isMeta
              ? "border border-dashed border-violet-400/60 bg-background text-violet-500"
              : tagTypeBgClass[tt],
          )}
          aria-hidden="true"
        >
          {isMeta
            ? <Layers class="h-5 w-5" />
            : Icon
            ? <Icon size="md" class={tagTypeTextClass[tt]} />
            : null}
        </div>
        <div class="min-w-0 flex-1">
          <p class="text-[10px] uppercase tracking-wide text-muted-foreground">
            {typeLabel}
          </p>
          <code
            class="block truncate font-mono text-sm font-medium"
            title={idTag}
          >
            {idTag}
          </code>
        </div>
        {quickAction}
      </div>

      {/* Middle: display name + notes */}
      <div class="pointer-events-none relative min-w-0 flex-1">
        {displayName
          ? (
            <p class="truncate text-sm" title={displayName}>
              {displayName}
            </p>
          )
          : (
            <p class="truncate text-sm italic text-muted-foreground">
              No display name
            </p>
          )}
        {notes
          ? (
            <p
              class="mt-1 line-clamp-2 text-xs text-muted-foreground"
              title={notes}
            >
              {notes}
            </p>
          )
          : null}
      </div>

      {/* Bottom: parent + pills */}
      <div class="pointer-events-none relative flex flex-wrap items-end justify-between gap-2">
        {parentIdTag
          ? (
            <p
              class="inline-flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground"
              title={`Parent: ${parentIdTag}`}
            >
              <CornerDownRight class="h-3 w-3 shrink-0" aria-hidden="true" />
              <code class="truncate font-mono">{parentIdTag}</code>
            </p>
          )
          : <span class="sr-only">No parent</span>}
        <StatusPillRow
          pills={pills}
          variant="bare"
          class="ml-auto justify-end"
        />
      </div>
    </div>
  );
}

interface QuickActionInput {
  ocppTagPk: number;
  hasLagoCustomer: boolean;
  isMeta: boolean;
  isActive: boolean;
}

function buildQuickAction(
  { ocppTagPk, hasLagoCustomer, isMeta, isActive }: QuickActionInput,
): ComponentChildren {
  // Meta-tags can't be issued cards against and don't need linking shortcuts.
  // Inactive tags hide the quick-action to avoid surfacing dead ends.
  if (isMeta || !isActive) return null;

  const label = hasLagoCustomer ? "Issue card" : "Link to customer";
  const href = hasLagoCustomer
    ? `/tags/${ocppTagPk}#issue-card`
    : `/links/new?tagPk=${ocppTagPk}`;
  const Icon = hasLagoCustomer ? CreditCard : Link2;

  // `relative z-10 pointer-events-auto` puts this quick-action above the
  // stretched primary-link `<a>` so the click lands here instead of
  // navigating to the detail page.
  return (
    <a
      href={href}
      aria-label={label}
      title={label}
      class={cn(
        "pointer-events-auto relative z-10 flex size-8 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground",
        "opacity-0 transition-opacity",
        "group-hover:opacity-100 group-focus-within:opacity-100",
        "hover:border-cyan-500/60 hover:text-foreground",
        "focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <Icon class="h-4 w-4" aria-hidden="true" />
    </a>
  );
}

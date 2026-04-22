/**
 * Small clickable chip rendering an OCPP tag. One visual token used across:
 *   - Tag Details hierarchy panel (parent + children).
 *   - Tag Linking edit header (idTag chip).
 *   - Charger recent-transactions (tag column).
 *
 * Renders as an `<a>` so navigation is native + keyboard-accessible; pass
 * `href={null}` to get a plain span (e.g. when the target tag is the one
 * we're currently on).
 */

import type { ComponentChildren } from "preact";
import { CornerDownRight, Layers } from "lucide-preact";
import { cn } from "@/src/lib/utils/cn.ts";
import { isMetaTag } from "@/src/lib/tag-hierarchy.ts";
import { TAG_TYPES, type TagType } from "@/src/lib/types/tags.ts";
import { tagTypeIcons } from "@/components/brand/tags/index.ts";
import { tagTypeBgClass, tagTypeTextClass } from "@/src/lib/tag-visuals.ts";

interface Props {
  /** The OCPP id tag (shown mono); also used to detect meta-tag by prefix. */
  idTag: string;
  /** Primary key, used to build the href. */
  tagPk: number;
  /** DB-known tag type; renders as an icon. Meta-tags override to a layers glyph. */
  tagType?: string | null;
  /** Optional friendly name shown after the idTag in a muted tone. */
  displayName?: string | null;
  /** Marks this chip as a child of some parent — adds a subtle leading glyph. */
  isChild?: boolean;
  /** When true the chip renders with violet-tinted link affordance; when
   *  false the chip still links but renders with muted treatment to hint
   *  the target is unlinked / lacks a Lago customer. Default: `true`. */
  hasLagoCustomer?: boolean;
  /** Override the default nav target (`/tags/[tagPk]`); pass `null` to
   *  render as an inert `<span>` — useful on the current-tag chip. */
  href?: string | null;
  class?: string;
}

function coerceTagType(value: string | null | undefined): TagType {
  return value && (TAG_TYPES as readonly string[]).includes(value)
    ? (value as TagType)
    : "other";
}

export function TagChip({
  idTag,
  tagPk,
  tagType,
  displayName,
  isChild,
  hasLagoCustomer = true,
  href,
  class: className,
}: Props) {
  const meta = isMetaTag(idTag);
  const tt = coerceTagType(tagType);
  const Icon = meta ? Layers : tagTypeIcons[tt];
  const target = href === undefined ? `/tags/${tagPk}` : href;

  const body: ComponentChildren = (
    <>
      {isChild
        ? <CornerDownRight class="h-3 w-3 shrink-0 text-muted-foreground" />
        : null}
      <span
        class={cn(
          "flex size-5 items-center justify-center rounded",
          meta
            ? "border border-dashed border-input bg-background text-muted-foreground"
            : tagTypeBgClass[tt],
        )}
        aria-hidden="true"
      >
        <Icon size="sm" class={meta ? undefined : tagTypeTextClass[tt]} />
      </span>
      <code class="font-mono text-xs font-medium truncate">{idTag}</code>
      {displayName
        ? (
          <span class="truncate text-xs text-muted-foreground">
            {displayName}
          </span>
        )
        : null}
    </>
  );

  const classes = cn(
    "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
    hasLagoCustomer
      ? "bg-background hover:bg-accent hover:text-accent-foreground"
      : "border-dashed bg-muted/40 text-muted-foreground hover:bg-muted",
    target
      ? "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      : null,
    className,
  );

  if (target) {
    return (
      <a
        href={target}
        class={classes}
        aria-label={`Tag ${idTag}${displayName ? ` — ${displayName}` : ""}`}
      >
        {body}
      </a>
    );
  }
  return <span class={classes}>{body}</span>;
}

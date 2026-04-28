/**
 * ParentTagGrid — compact card grid for selecting an OCPP meta-tag parent.
 *
 * Replaces the legacy `<input>` + `<datalist>` parent picker. Each cell is
 * an `aria-pressed` toggle button styled like a `StatStripItem` cell, with
 * the tag-type icon-well + idTag (mono). The first tile is always
 * "No parent" — dashed border, muted tone, sets the value to `null`.
 *
 * Filter input appears above the grid only once `candidates.length > 8`.
 * Empty state for zero candidates points the user at how to create a
 * meta-tag.
 */

import { useMemo, useState } from "preact/hooks";
import { Slash } from "lucide-preact";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { cn } from "@/src/lib/utils/cn.ts";
import { stripToneClasses } from "@/src/lib/colors.ts";
import { tagTypeIcons } from "@/components/brand/tags/index.ts";
import { tagTypeBgClass, tagTypeTextClass } from "@/src/lib/tag-visuals.ts";
import { META_TAG_PREFIX } from "@/src/lib/tag-hierarchy.ts";
import type { TagType } from "@/src/lib/types/tags.ts";

export interface ParentCandidate {
  idTag: string;
  ocppTagPk: number;
  tagType: TagType | null;
  displayName: string | null;
  isMeta: boolean;
  hasLagoCustomer: boolean;
}

interface ParentTagGridProps {
  candidates: ParentCandidate[];
  /** Currently selected parent idTag, or null for "No parent". */
  value: string | null;
  onChange: (idTag: string | null) => void;
  disabled?: boolean;
  /** Show the filter input regardless of candidate count. */
  forceFilter?: boolean;
  /** Override the default ID prefix (used by tests / multiple grids on a page). */
  idPrefix?: string;
}

export function ParentTagGrid({
  candidates,
  value,
  onChange,
  disabled,
  forceFilter,
  idPrefix = "ptg",
}: ParentTagGridProps) {
  const [filter, setFilter] = useState("");
  const showFilter = forceFilter || candidates.length > 8;

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((c) =>
      c.idTag.toLowerCase().includes(q) ||
      (c.displayName?.toLowerCase().includes(q) ?? false)
    );
  }, [candidates, filter]);

  if (candidates.length === 0) {
    return (
      <p class="text-xs text-muted-foreground">
        No meta-tags exist yet. Create a meta-tag (use the{" "}
        <code>{META_TAG_PREFIX}</code> prefix) to nest tags under it.
      </p>
    );
  }

  const cyan = stripToneClasses.cyan;
  const muted = stripToneClasses.muted;

  return (
    <div class="space-y-2">
      {showFilter
        ? (
          <div class="space-y-1">
            <Label for={`${idPrefix}-filter`} class="sr-only">
              Filter parents
            </Label>
            <Input
              id={`${idPrefix}-filter`}
              placeholder="Filter parents…"
              value={filter}
              onInput={(e) =>
                setFilter((e.currentTarget as HTMLInputElement).value)}
              disabled={disabled}
            />
          </div>
        )
        : null}

      <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        <button
          type="button"
          aria-pressed={value === null}
          disabled={disabled}
          onClick={() => onChange(null)}
          class={cn(
            "flex items-center gap-3 rounded-lg border border-dashed px-3 py-2.5 text-left transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50",
            muted.cell,
            muted.hoverBorder,
            value === null && muted.ring,
          )}
        >
          <span
            class={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-md",
              muted.iconWell,
            )}
            aria-hidden="true"
          >
            <Slash class="size-4" />
          </span>
          <span class="min-w-0 flex-1 truncate text-sm">No parent</span>
        </button>

        {filtered.map((c) => {
          const Icon = c.tagType ? tagTypeIcons[c.tagType] : null;
          const bg = c.tagType ? tagTypeBgClass[c.tagType] : "bg-muted";
          const fg = c.tagType
            ? tagTypeTextClass[c.tagType]
            : "text-muted-foreground";
          const selected = value === c.idTag;
          return (
            <button
              key={c.idTag}
              type="button"
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => onChange(c.idTag)}
              title={c.displayName ?? c.idTag}
              class={cn(
                "flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50",
                cyan.cell,
                cyan.hoverBorder,
                selected && cyan.ring,
              )}
            >
              <span
                class={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-md",
                  bg,
                )}
                aria-hidden="true"
              >
                {Icon ? <Icon size="sm" class={fg} /> : null}
              </span>
              <span class="min-w-0 flex-1 truncate font-mono text-sm">
                {c.idTag}
              </span>
            </button>
          );
        })}

        {showFilter && filtered.length === 0
          ? (
            <p class="col-span-full text-xs text-muted-foreground">
              No parents match "{filter}".
            </p>
          )
          : null}
      </div>
    </div>
  );
}

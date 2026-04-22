/**
 * Tag Details header strip — top-of-page identity band for `/tags/[tagPk]`.
 *
 * Renders:
 *   - a form-factor icon + the mono OCPP id tag,
 *   - an optional display-name subtitle,
 *   - a `StatusPillRow` with Meta-tag / Linked / Active / Has-parent pills.
 *
 * Server-rendered — no interactive state lives here.
 */

import { CornerDownRight, Layers } from "lucide-preact";
import { cn } from "@/src/lib/utils/cn.ts";
import { type Pill, StatusPillRow } from "@/components/tags/StatusPillRow.tsx";
import { tagTypeIcons } from "@/components/brand/tags/index.ts";
import {
  TAG_TYPES,
  type TagType,
  tagTypeLabels,
} from "@/src/lib/types/tags.ts";
import {
  tagTypeBgClass,
  tagTypeTextClass,
} from "@/src/lib/tag-visuals.ts";

interface Props {
  idTag: string;
  displayName?: string | null;
  tagType?: string | null;
  isMeta: boolean;
  isLinked: boolean;
  isActive: boolean;
  /** Parent idTag, if any — shown as a subtle leading line. */
  parentIdTag?: string | null;
}

function coerceTagType(value: string | null | undefined): TagType {
  return value && (TAG_TYPES as readonly string[]).includes(value)
    ? (value as TagType)
    : "other";
}

export function TagHeaderStrip(
  { idTag, displayName, tagType, isMeta, isLinked, isActive, parentIdTag }:
    Props,
) {
  const tt = coerceTagType(tagType);
  const Icon = isMeta ? null : tagTypeIcons[tt];

  const pills: Pill[] = [];
  if (isMeta) {
    pills.push({
      label: "Meta-tag",
      tone: "violet",
      dashed: true,
      title: "OCPP-* tags are hierarchy rollups, not physical cards.",
    });
  }
  pills.push(
    isLinked
      ? { label: "Linked", tone: "cyan" }
      : { label: "Unlinked", tone: "amber", dashed: true },
  );
  pills.push(
    isActive
      ? { label: "Active", tone: "emerald", live: true }
      : { label: "Inactive", tone: "muted", live: true, dashed: true },
  );
  if (parentIdTag) {
    pills.push({
      label: `Has parent: ${parentIdTag}`,
      tone: "neutral",
      title: `Inherits from ${parentIdTag}`,
    });
  }

  return (
    <div class="flex flex-col gap-3">
      <div class="flex items-start gap-3">
        <div
          class={cn(
            "flex size-12 shrink-0 items-center justify-center rounded-lg",
            isMeta
              ? "border border-dashed border-input bg-background text-muted-foreground"
              : tagTypeBgClass[tt],
          )}
          aria-hidden="true"
        >
          {isMeta
            ? <Layers class="h-6 w-6" />
            : Icon
            ? <Icon size="lg" class={tagTypeTextClass[tt]} />
            : null}
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <code class="font-mono text-base font-semibold tracking-tight sm:text-lg">
              {idTag}
            </code>
            <span class="text-xs uppercase tracking-wide text-muted-foreground">
              {isMeta ? "Meta-tag" : tagTypeLabels[tt]}
            </span>
          </div>
          {displayName
            ? (
              <p class="mt-0.5 truncate text-sm text-muted-foreground">
                {displayName}
              </p>
            )
            : null}
          {parentIdTag
            ? (
              <p class="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                <CornerDownRight class="h-3 w-3" aria-hidden="true" />
                <span>child of</span>
                <code class="font-mono">{parentIdTag}</code>
              </p>
            )
            : null}
        </div>
      </div>
      <StatusPillRow pills={pills} />
    </div>
  );
}

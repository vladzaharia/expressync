/**
 * TagsStatStrip — tags listing stat strip.
 *
 * Five cells, each a filter-shortcut:
 *   1. Total tags — cyan,    `/tags`              (reset; always live)
 *   2. Linked     — emerald, `/tags?linked=1`
 *   3. Unlinked   — amber,   `/tags?linked=0`     (dashed)
 *   4. Meta-tags  — violet,  `/tags?meta=1`       (dashed)
 *   5. Inactive   — muted,   `/tags?active=0`
 *
 * Thin wrapper over the shared `StatStrip` primitive.
 */

import { CircleSlash, Layers, Link2, Tag, Unlink } from "lucide-preact";
import {
  StatStrip,
  type StatStripItem,
} from "@/components/shared/StatStrip.tsx";

export interface TagsStatStripTotals {
  all: number;
  linked: number;
  unlinked: number;
  meta: number;
  inactive: number;
}

/** Which stat-strip cell is currently selected by the URL filter, if any. */
export type TagsStatStripActive =
  | "all"
  | "linked"
  | "unlinked"
  | "meta"
  | "inactive"
  | null;

interface Props {
  totals: TagsStatStripTotals;
  active?: TagsStatStripActive;
  class?: string;
}

export function TagsStatStrip(
  { totals, active = null, class: className }: Props,
) {
  const items: StatStripItem[] = [
    {
      key: "all",
      label: "Total tags",
      value: totals.all,
      icon: Tag,
      tone: "cyan",
      href: "/tags",
      active: active === "all",
    },
    {
      key: "linked",
      label: "Linked",
      value: totals.linked,
      icon: Link2,
      tone: "emerald",
      href: "/tags?linked=1",
      active: active === "linked",
      disabledWhenZero: true,
    },
    {
      key: "unlinked",
      label: "Unlinked",
      value: totals.unlinked,
      icon: Unlink,
      tone: "amber",
      href: "/tags?linked=0",
      active: active === "unlinked",
      disabledWhenZero: true,
      dashed: true,
    },
    {
      key: "meta",
      label: "Meta-tags",
      value: totals.meta,
      icon: Layers,
      tone: "violet",
      href: "/tags?meta=1",
      active: active === "meta",
      disabledWhenZero: true,
      dashed: true,
    },
    {
      key: "inactive",
      label: "Inactive",
      value: totals.inactive,
      icon: CircleSlash,
      tone: "muted",
      href: "/tags?active=0",
      active: active === "inactive",
      disabledWhenZero: true,
    },
  ];

  return <StatStrip items={items} accent="cyan" class={className} />;
}

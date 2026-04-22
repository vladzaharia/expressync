/**
 * LinkingStatStrip — tag-linking listing stat strip.
 *
 * Four cells. The "Unlinked tags" cell becomes a tappable warning link to
 * `/tags?filter=unlinked` when there are any unlinked tags. Thin wrapper
 * over the shared `StatStrip` primitive.
 */

import { AlertTriangle, Layers, Tag, Users } from "lucide-preact";
import {
  StatStrip,
  type StatStripItem,
} from "@/components/shared/StatStrip.tsx";

interface Totals {
  customersLinked: number;
  tagsLinked: number;
  metaTagsLinked: number;
  unlinkedTagCount: number;
}

interface Props {
  totals: Totals;
  class?: string;
}

export function LinkingStatStrip({ totals, class: className }: Props) {
  const hasUnlinked = totals.unlinkedTagCount > 0;

  const items: StatStripItem[] = [
    {
      key: "customers",
      label: "Customers linked",
      value: totals.customersLinked,
      icon: Users,
      tone: "violet",
    },
    {
      key: "tags",
      label: "Tags linked",
      value: totals.tagsLinked,
      icon: Tag,
      tone: "cyan",
    },
    {
      key: "meta",
      label: "Meta-tags",
      value: totals.metaTagsLinked,
      icon: Layers,
      tone: "violet",
    },
    {
      key: "unlinked",
      label: "Unlinked tags",
      value: totals.unlinkedTagCount,
      icon: AlertTriangle,
      tone: hasUnlinked ? "amber" : "muted",
      href: hasUnlinked ? "/tags?filter=unlinked" : undefined,
    },
  ];

  return <StatStrip items={items} accent="violet" class={className} />;
}

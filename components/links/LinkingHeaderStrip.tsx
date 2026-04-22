/**
 * LinkingHeaderStrip — top-of-page identity band for `/links/[id]`.
 *
 * Mirrors `TagHeaderStrip` visually but the anchor is the mapping: we show
 * the form-factor (or Layers for meta) icon + mono idTag, and a pill row
 * with Active/Inactive, Meta-tag, CustomerChip, SubscriptionChip, and a
 * cards-issued count.
 *
 * Cross-domain chips (Customer, Subscription) render as outlined pills with
 * violet border and `role="link"` semantics. Absent subscription collapses
 * to a dashed "No active subscription" pill — tagged in the plan.
 *
 * Server-rendered.
 */

import { CreditCard, ExternalLink, Layers, User } from "lucide-preact";
import { cn } from "@/src/lib/utils/cn.ts";
import { Badge } from "@/components/ui/badge.tsx";
import { type Pill, StatusPillRow } from "@/components/tags/StatusPillRow.tsx";
import { tagTypeIcons } from "@/components/brand/tags/index.ts";
import {
  TAG_TYPES,
  type TagType,
  tagTypeLabels,
} from "@/src/lib/types/tags.ts";
import { tagTypeBgClass, tagTypeTextClass } from "@/src/lib/tag-visuals.ts";

interface Props {
  idTag: string;
  tagType?: string | null;
  isMeta: boolean;
  isActive: boolean;
  customer: null | {
    externalId: string;
    name: string;
    lagoUrl?: string | null;
  };
  subscription: null | {
    externalId: string;
    name: string;
    lagoUrl?: string | null;
  };
  /** Tag-details route for drill-down. */
  tagPk: number;
}

function coerceTagType(value: string | null | undefined): TagType {
  return value && (TAG_TYPES as readonly string[]).includes(value)
    ? (value as TagType)
    : "other";
}

export function LinkingHeaderStrip(props: Props) {
  const {
    idTag,
    tagType,
    isMeta,
    isActive,
    customer,
    subscription,
    tagPk: _tagPk,
  } = props;

  const tt = coerceTagType(tagType);
  const Icon = isMeta ? null : tagTypeIcons[tt];

  const pills: Pill[] = [
    isActive
      ? { label: "Active", tone: "emerald", live: true }
      : { label: "Inactive", tone: "muted", live: true, dashed: true },
  ];
  if (isMeta) {
    pills.push({
      label: "Meta-tag",
      tone: "violet",
      dashed: true,
      title: "OCPP-* tags are hierarchy rollups, not physical cards.",
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
          {customer && (
            <p class="mt-0.5 flex items-center gap-1 text-sm text-muted-foreground truncate">
              <User class="size-3.5" aria-hidden="true" />
              <span class="truncate">{customer.name}</span>
            </p>
          )}
        </div>
      </div>

      <StatusPillRow pills={pills} />

      {/* Cross-domain chip row */}
      <div class="flex flex-wrap items-center gap-2">
        {customer
          ? (
            customer.lagoUrl
              ? (
                <a
                  href={customer.lagoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex max-w-full items-center gap-1.5 rounded-full border border-cyan-500/50 bg-cyan-500/5 px-2.5 py-1 text-xs hover:bg-cyan-500/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
                  aria-label={`Customer ${customer.name} (opens in new tab)`}
                >
                  <User class="size-3 text-cyan-600" aria-hidden="true" />
                  <span class="truncate">{customer.name}</span>
                  <ExternalLink class="size-3 opacity-60" aria-hidden="true" />
                </a>
              )
              : (
                <span class="inline-flex max-w-full items-center gap-1.5 rounded-full border border-cyan-500/50 bg-cyan-500/5 px-2.5 py-1 text-xs">
                  <User class="size-3 text-cyan-600" aria-hidden="true" />
                  <span class="truncate">{customer.name}</span>
                </span>
              )
          )
          : (
            <span class="inline-flex items-center gap-1.5 rounded-full border border-dashed bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground">
              <User class="size-3" aria-hidden="true" />
              Unlinked customer
            </span>
          )}

        {subscription
          ? (
            subscription.lagoUrl
              ? (
                <a
                  href={subscription.lagoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex max-w-full items-center gap-1.5 rounded-full border border-violet-500/50 bg-violet-500/5 px-2.5 py-1 text-xs hover:bg-violet-500/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                  aria-label={`Subscription ${subscription.name} (opens in new tab)`}
                >
                  <CreditCard
                    class="size-3 text-violet-600"
                    aria-hidden="true"
                  />
                  <span class="truncate">{subscription.name}</span>
                  <ExternalLink class="size-3 opacity-60" aria-hidden="true" />
                </a>
              )
              : (
                <span class="inline-flex max-w-full items-center gap-1.5 rounded-full border border-violet-500/50 bg-violet-500/5 px-2.5 py-1 text-xs">
                  <CreditCard
                    class="size-3 text-violet-600"
                    aria-hidden="true"
                  />
                  <span class="truncate">{subscription.name}</span>
                </span>
              )
          )
          : (
            <span class="inline-flex items-center gap-1.5 rounded-full border border-dashed bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground">
              <CreditCard class="size-3" aria-hidden="true" />
              No active subscription
            </span>
          )}

        {isMeta && (
          <Badge variant="outline" className="text-[10px] uppercase">
            META
          </Badge>
        )}
      </div>
    </div>
  );
}

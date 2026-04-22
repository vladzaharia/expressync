/**
 * TagLinkingGrid — orchestrator for the customer/tag rows on `/links`.
 *
 * The grid renders one row per (customer, subscription) pair plus its tags.
 * The visual tokens are split into three sub-components so `/links/[id]`
 * can reuse them later:
 *
 *   - `CustomerCard` — the left-hand identity block.
 *   - `TagCard`      — a single OCPP tag card (with meta-tag treatment).
 *   - `LinkingRowActions` — Active/Edit/Delete button trio.
 *
 * Meta-tag rows swap the form-factor icon for `Layers`, add a tinted
 * violet background, stamp a `META` outlined badge, and hide the row-level
 * Issue Card button.
 *
 * The legacy `confirm()` delete is replaced with an accessible `<Dialog>`
 * whose default focus lands on the safe Cancel button; the destructive
 * label is explicit ("Delete link") per the plan's a11y rules.
 */

import { useSignal } from "@preact/signals";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowRight,
  Check,
  CornerDownRight,
  CreditCard,
  Layers,
  Pencil,
  Trash2,
  User,
  X,
} from "lucide-preact";
import { Button } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Card, CardContent } from "@/components/ui/card.tsx";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog.tsx";
import { cn } from "@/src/lib/utils/cn.ts";
import { tagTypeIcons } from "@/components/brand/tags/index.ts";
import {
  TAG_TYPES,
  type TagType,
  tagTypeLabels,
} from "@/src/lib/types/tags.ts";
import { tagTypeBgClass, tagTypeTextClass } from "@/src/lib/tag-visuals.ts";
import { isMetaTag } from "@/src/lib/tag-hierarchy.ts";

function coerceTagType(value: string | null | undefined): TagType {
  return value && (TAG_TYPES as readonly string[]).includes(value)
    ? (value as TagType)
    : "other";
}

interface RowTag {
  id: string;
  ocppTagPk: number;
  mappingId: number;
  isChild: boolean;
  tagType: string;
}

export interface MappingGroup {
  customerId: string;
  customerName: string;
  customerEmail?: string;
  customerLagoId?: string;
  subscriptionId: string;
  subscriptionName?: string;
  subscriptionLagoId?: string;
  isActive: boolean;
  tags: RowTag[];
}

interface Props {
  groups: MappingGroup[];
  lagoDashboardUrl?: string;
  steveDashboardUrl?: string;
}

// Shared card height for consistency across customer/tag cards.
const CARD_HEIGHT_CLASS = "min-h-[52px]";

export default function TagLinkingGrid(
  { groups: initialGroups, lagoDashboardUrl, steveDashboardUrl }: Props,
) {
  const groups = useSignal(initialGroups);
  const deletingId = useSignal<number | null>(null);
  // Mapping id currently targeted by the delete dialog, null = closed.
  const deleteTarget = useSignal<
    | {
      mappingId: number;
      isMeta: boolean;
      cascadeCount: number;
      idTag: string;
    }
    | null
  >(null);

  // URL builders
  const customerUrl = (lagoCustomerId?: string) =>
    lagoDashboardUrl && lagoCustomerId
      ? `${lagoDashboardUrl}/customer/${lagoCustomerId}`
      : null;

  const subscriptionUrl = (
    lagoCustomerId?: string,
    lagoSubscriptionId?: string,
  ) =>
    lagoDashboardUrl && lagoCustomerId && lagoSubscriptionId
      ? `${lagoDashboardUrl}/customer/${lagoCustomerId}/subscription/${lagoSubscriptionId}/overview`
      : null;

  const ocppTagUrl = (ocppTagPk: number) =>
    steveDashboardUrl
      ? `${steveDashboardUrl}/manager/ocppTags/details/${ocppTagPk}`
      : null;

  const handleConfirmDelete = async () => {
    const target = deleteTarget.value;
    if (!target) return;
    deletingId.value = target.mappingId;
    try {
      const res = await fetch(`/api/admin/tag/link?id=${target.mappingId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.deletedCount && data.deletedCount > 1) {
          toast.success(
            `Deleted ${data.deletedCount} mappings (1 parent + ${
              data.deletedCount - 1
            } children)`,
          );
        } else {
          toast.success("Link deleted");
        }
        globalThis.location.reload();
      } else {
        toast.error("Failed to delete mapping");
        deletingId.value = null;
        deleteTarget.value = null;
      }
    } catch (_e) {
      toast.error("An error occurred");
      deletingId.value = null;
      deleteTarget.value = null;
    }
  };

  const handleToggleActive = async (mappingId: number, isActive: boolean) => {
    // Optimistic flip; toast failure is a soft rollback on the same page.
    const idx = groups.value.findIndex((g) =>
      g.tags.some((t) => t.mappingId === mappingId)
    );
    if (idx < 0) return;
    const next = [...groups.value];
    next[idx] = { ...next[idx], isActive: !isActive };
    groups.value = next;

    try {
      const res = await fetch(`/api/admin/tag/link?id=${mappingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !isActive }),
      });
      if (!res.ok) throw new Error("server");
      toast.success(!isActive ? "Link activated" : "Link deactivated");
    } catch (_e) {
      // Roll back
      const rollback = [...groups.value];
      rollback[idx] = { ...rollback[idx], isActive };
      groups.value = rollback;
      toast.error("Failed to update — reverted.");
    }
  };

  if (groups.value.length === 0) {
    // The list route owns the richer empty-state component; fall back to a
    // tiny text-only block if this grid ever renders with zero groups.
    return (
      <div class="text-center py-12 text-muted-foreground">
        <p class="mb-4">No tag links found.</p>
      </div>
    );
  }

  return (
    <>
      <div class="space-y-4">
        {groups.value.map((group) => {
          const parentTags = group.tags.filter((t) => !t.isChild);
          const childTags = group.tags.filter((t) => t.isChild);
          const primaryMappingId = parentTags[0]?.mappingId;
          const primaryTag = parentTags[0];
          const primaryIsMeta = primaryTag ? isMetaTag(primaryTag.id) : false;

          const allTags: RowTag[] = [
            ...parentTags.map((t) => ({ ...t, isChild: false })),
            ...childTags.map((t) => ({ ...t, isChild: true })),
          ];

          const cascadeCount = group.tags.length; // 1 parent + N children
          const hasSubscription = !!group.subscriptionId;
          const linkUrl = hasSubscription
            ? subscriptionUrl(group.customerLagoId, group.subscriptionLagoId)
            : customerUrl(group.customerLagoId);

          return (
            <div
              key={`${group.customerId}:${group.subscriptionId}`}
              class={cn(
                "flex flex-col md:flex-row md:items-center gap-4 p-4 rounded-lg border bg-card",
                !group.isActive && "opacity-60",
                primaryIsMeta && "bg-violet-500/10",
              )}
            >
              <CustomerCard
                group={group}
                linkUrl={linkUrl}
                hasSubscription={hasSubscription}
              />

              {/* Arrow — horizontal on desktop, vertical on mobile */}
              <div class="hidden md:flex items-center text-muted-foreground shrink-0">
                <ArrowRight class="size-5" aria-hidden="true" />
              </div>
              <div class="flex md:hidden items-center justify-center text-muted-foreground">
                <ArrowDown class="size-5" aria-hidden="true" />
              </div>

              {/* Tags */}
              {(() => {
                const totalTags = allTags.length;
                const hasOddCount = totalTags % 2 === 1;
                return (
                  <div class="flex-1 grid grid-cols-2 md:flex md:flex-wrap items-stretch content-start gap-2 min-w-0 overflow-hidden">
                    {allTags.map((tag, index) => (
                      <TagCard
                        key={tag.id}
                        tag={tag}
                        href={ocppTagUrl(tag.ocppTagPk)}
                        isLastOdd={hasOddCount && index === totalTags - 1}
                      />
                    ))}
                  </div>
                );
              })()}

              {/* Row actions */}
              {primaryMappingId !== undefined && primaryTag && (
                <LinkingRowActions
                  mappingId={primaryMappingId}
                  isActive={group.isActive}
                  isMeta={primaryIsMeta}
                  onToggleActive={() =>
                    handleToggleActive(primaryMappingId, group.isActive)}
                  onRequestDelete={() => {
                    deleteTarget.value = {
                      mappingId: primaryMappingId,
                      isMeta: primaryIsMeta,
                      cascadeCount,
                      idTag: primaryTag.id,
                    };
                  }}
                  deleting={deletingId.value === primaryMappingId}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Accessible delete confirmation dialog */}
      <ConfirmDialog
        open={deleteTarget.value !== null}
        onOpenChange={(open) => {
          if (!open) deleteTarget.value = null;
        }}
        title={deleteTarget.value?.isMeta
          ? "Delete meta-tag link?"
          : "Delete tag link?"}
        description={deleteTarget.value
          ? (
            deleteTarget.value.isMeta && deleteTarget.value.cascadeCount > 1
              ? (
                <>
                  This will delete this meta-tag link and{" "}
                  <strong>
                    {deleteTarget.value.cascadeCount - 1} inherited child link
                    {deleteTarget.value.cascadeCount - 1 === 1 ? "" : "s"}
                  </strong>. The underlying OCPP tags are not removed.
                </>
              )
              : deleteTarget.value.cascadeCount > 1
              ? (
                <>
                  This will delete this link and{" "}
                  <strong>
                    {deleteTarget.value.cascadeCount - 1} child link
                    {deleteTarget.value.cascadeCount - 1 === 1 ? "" : "s"}
                  </strong>. The underlying OCPP tags are not removed.
                </>
              )
              : (
                <>
                  This will delete the mapping for{" "}
                  <code className="font-mono">{deleteTarget.value.idTag}</code>.
                  The underlying OCPP tag is not removed.
                </>
              )
          )
          : null}
        variant="destructive"
        confirmLabel={deleteTarget.value?.isMeta
          ? "Delete meta-tag link"
          : "Delete link"}
        onConfirm={handleConfirmDelete}
        isLoading={deletingId.value !== null}
      />
    </>
  );
}

/* --------------------------------------------------------------------------
 * Sub-components
 * ------------------------------------------------------------------------ */

function CustomerCard(
  { group, linkUrl, hasSubscription }: {
    group: MappingGroup;
    linkUrl: string | null;
    hasSubscription: boolean;
  },
) {
  const Icon = hasSubscription ? CreditCard : User;
  const displayName = group.customerName || group.customerEmail ||
    group.customerId;
  const subtext = hasSubscription
    ? (group.subscriptionName || group.subscriptionId)
    : "";

  const content = (
    <CardContent
      class={cn(
        "px-5 py-1.5 h-full flex flex-col justify-center",
        CARD_HEIGHT_CLASS,
      )}
    >
      <div class="flex items-center gap-4">
        <div class="flex size-8 items-center justify-center rounded-lg bg-violet-500/10 shrink-0">
          <Icon class="size-4 text-violet-500" aria-hidden="true" />
        </div>
        <div class="min-w-0 flex-1">
          <p class="font-semibold truncate text-sm">{displayName}</p>
          {subtext && (
            <p class="text-xs text-muted-foreground truncate">
              {subtext}
            </p>
          )}
        </div>
      </div>
    </CardContent>
  );

  if (linkUrl) {
    return (
      <a
        href={linkUrl}
        target="_blank"
        rel="noopener noreferrer"
        class="shrink-0 self-stretch"
        aria-label={`${displayName} — open in Lago (opens in new tab)`}
      >
        <Card class="min-w-56 h-full border-2 hover:border-violet-500/70 transition-colors cursor-pointer">
          {content}
        </Card>
      </a>
    );
  }
  return (
    <Card class="min-w-56 shrink-0 self-stretch">
      {content}
    </Card>
  );
}

function TagCard(
  { tag, href, isLastOdd }: {
    tag: RowTag;
    href: string | null;
    isLastOdd: boolean;
  },
) {
  const meta = isMetaTag(tag.id);
  const tt = coerceTagType(tag.tagType);
  const TypeIcon = meta ? Layers : tagTypeIcons[tt];

  const body = (
    <CardContent
      class={cn(
        "px-4 py-1.5 h-full flex items-center gap-3",
        CARD_HEIGHT_CLASS,
      )}
    >
      <div
        class={cn(
          "flex size-8 items-center justify-center rounded-lg shrink-0",
          meta ? "bg-violet-500/10" : tagTypeBgClass[tt],
        )}
        aria-label={meta ? "Meta-tag" : `${tagTypeLabels[tt]} tag`}
      >
        {meta
          ? <Layers class="size-4 text-violet-500" aria-hidden="true" />
          : <TypeIcon size="sm" class={tagTypeTextClass[tt]} />}
      </div>
      {tag.isChild && (
        <CornerDownRight
          class="size-4 text-muted-foreground shrink-0"
          aria-hidden="true"
        />
      )}
      <span
        class={cn(
          "font-mono text-sm flex-1 truncate",
          !tag.isChild && "font-medium",
        )}
      >
        {tag.id}
      </span>
      {meta && (
        <Badge variant="outline" className="text-[10px] uppercase shrink-0">
          META
        </Badge>
      )}
    </CardContent>
  );

  const cardClasses = cn(
    "shrink-0 h-full border-2 transition-colors",
    tag.isChild && !meta && "bg-muted/30",
    href && "hover:border-violet-500/70 cursor-pointer",
  );

  const wrapperClasses = cn(
    "md:w-auto md:min-w-44",
    isLastOdd ? "col-span-2" : "col-span-1",
  );

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        class={wrapperClasses}
        aria-label={`${tag.id} — open in StEvE (opens in new tab)`}
      >
        <Card class={cardClasses}>{body}</Card>
      </a>
    );
  }
  return (
    <Card class={cn(cardClasses, wrapperClasses)}>
      {body}
    </Card>
  );
}

function LinkingRowActions(
  {
    mappingId,
    isActive,
    isMeta: _isMeta,
    onToggleActive,
    onRequestDelete,
    deleting,
  }: {
    mappingId: number;
    isActive: boolean;
    isMeta: boolean;
    onToggleActive: () => void;
    onRequestDelete: () => void;
    deleting: boolean;
  },
) {
  return (
    <div class="flex items-center justify-center md:justify-end gap-2 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-border w-full md:w-auto md:ml-auto">
      <Button
        variant="outline"
        size="sm"
        className={cn(
          "gap-2 md:gap-0",
          isActive
            ? "border-green-500 text-green-600 hover:bg-green-500/10 hover:text-green-600 dark:text-green-400 dark:hover:text-green-400"
            : "border-muted-foreground/50 text-muted-foreground hover:bg-muted/50",
        )}
        onClick={onToggleActive}
        aria-label={isActive ? "Deactivate link" : "Activate link"}
      >
        {isActive
          ? <Check class="size-4" aria-hidden="true" />
          : <X class="size-4" aria-hidden="true" />}
        <span class="md:hidden">{isActive ? "Active" : "Inactive"}</span>
      </Button>
      <Button
        variant="outline"
        size="sm"
        asChild
        className="gap-2 md:gap-0 border-purple-500 text-purple-600 hover:bg-purple-500/10 hover:text-purple-600 dark:text-purple-400 dark:hover:text-purple-400"
      >
        <a href={`/links/${mappingId}`} aria-label="Edit link">
          <Pencil class="size-4" aria-hidden="true" />
          <span class="md:hidden">Edit</span>
        </a>
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="gap-2 md:gap-0 border-red-500 text-red-600 hover:bg-red-500/10 hover:text-red-600 dark:text-red-400 dark:hover:text-red-400"
        onClick={onRequestDelete}
        disabled={deleting}
        aria-label="Delete link"
      >
        <Trash2 class="size-4" aria-hidden="true" />
        <span class="md:hidden">{deleting ? "Deleting…" : "Delete"}</span>
      </Button>
    </div>
  );
}

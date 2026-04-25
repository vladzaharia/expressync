/**
 * TagLinkCard — unified "Placement" card on `/tags/[tagPk]`.
 *
 * Replaces the previous separate `TagLinkingCard` and `TagRelationsSection`.
 * Answers a single question: *where does this tag belong?* — the customer
 * it bills, the subscription in effect, and its family (parent meta-tag +
 * children). A one-line narrative sentence at the top explains the
 * placement; structured blocks below surface the underlying data + CTAs.
 *
 * Rules of the house (see CLAUDE.md):
 *   - Uses `SectionCard` primitive; no new chrome.
 *   - Inherits the page accent (cyan). Semantic tone overrides only for
 *     status (amber/rose/emerald).
 *   - Meta-tag variant: children zone is always rendered (even empty).
 *   - Non-meta variant: family zone rendered only when there's actually a
 *     parent or children — otherwise the card stays linking-only.
 */

import { ExternalLink, Link2, Link2Off, Pencil, User } from "lucide-preact";
import { Badge } from "@/components/ui/badge.tsx";
import { SectionCard } from "@/components/shared/SectionCard.tsx";
import { TagChip } from "@/components/tags/TagChip.tsx";
import { PlanBadge } from "@/components/shared/PlanBadge.tsx";
import { cn } from "@/src/lib/utils/cn.ts";

export interface TagLinkingInfo {
  mappingId: number;
  /** External id passed to Lago as `external_customer_id`. */
  lagoCustomerExternalId: string | null;
  /** Lago internal UUID used to build dashboard URLs. */
  lagoCustomerLagoId: string | null;
  customerName: string | null;
  customerSlug: string | null;
  customerSequentialId: number | null;
  /** External id of the subscription (if the mapping names one). */
  lagoSubscriptionExternalId: string | null;
  /** Lago internal UUID used for subscription dashboard links. */
  lagoSubscriptionLagoId: string | null;
  subscriptionName: string | null;
  subscriptionPlanCode: string | null;
  subscriptionStatus: string | null;
  subscriptionCurrentPeriodEnd: string | null;
  billingTier: string;
}

export interface RelationTag {
  idTag: string;
  /** StEvE primary key — when null the tag isn't mapped locally yet. */
  tagPk: number | null;
  tagType: string | null;
  displayName: string | null;
  hasLagoCustomer: boolean;
}

interface Props {
  tagPk: number;
  isMeta: boolean;
  linking: TagLinkingInfo | null;
  relations: {
    parent: RelationTag | null;
    children: RelationTag[];
    hasAny: boolean;
  };
  lagoDashboardUrl: string;
  lagoFetchFailed: boolean;
  /** Optional hint (e.g. "3 unlinked sessions"). */
  warnLine?: string | null;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function statusTone(status: string | null): string {
  switch (status) {
    case "active":
      return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
    case "pending":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-400";
    case "terminated":
    case "canceled":
      return "bg-rose-500/15 text-rose-700 dark:text-rose-400";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function billingTierBadge(tier: string): { label: string; className: string } {
  switch (tier) {
    case "comped":
      return {
        label: "Comped",
        className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
      };
    case "standard":
    default:
      return {
        label: "Standard",
        className: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400",
      };
  }
}

export function TagLinkCard(
  {
    tagPk,
    isMeta,
    linking,
    relations,
    lagoDashboardUrl,
    lagoFetchFailed,
    warnLine,
  }: Props,
) {
  const customerUrl = linking && lagoDashboardUrl && linking.lagoCustomerLagoId
    ? `${lagoDashboardUrl}/customer/${linking.lagoCustomerLagoId}`
    : null;
  const subscriptionUrl = linking && lagoDashboardUrl &&
      linking.lagoCustomerLagoId && linking.lagoSubscriptionLagoId
    ? `${lagoDashboardUrl}/customer/${linking.lagoCustomerLagoId}/subscription/${linking.lagoSubscriptionLagoId}/overview`
    : null;

  // Header-level badges (tier + children count). Both live in the actions
  // slot so the SectionCard header is consistent with other cards.
  const tier = linking ? billingTierBadge(linking.billingTier) : null;
  const childCount = relations.children.length;
  const actions = (
    <>
      {tier && (
        <span
          class={cn(
            "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
            tier.className,
          )}
          title={`Billing tier: ${tier.label}`}
        >
          {tier.label}
        </span>
      )}
      {childCount > 0 && (
        <Badge variant="outline" class="font-normal">
          {childCount} child{childCount === 1 ? "" : "ren"}
        </Badge>
      )}
    </>
  );

  // Family zone is promoted for meta-tags (always render) or opt-in for
  // regular tags (only when there's a parent or any children).
  const showFamily = isMeta || relations.hasAny;

  return (
    <SectionCard
      title="Placement"
      icon={Link2}
      accent="cyan"
      actions={actions}
    >
      {linking
        ? (
          <LinkedBody
            linking={linking}
            tagPk={tagPk}
            customerUrl={customerUrl}
            subscriptionUrl={subscriptionUrl}
            lagoFetchFailed={lagoFetchFailed}
            warnLine={warnLine}
          />
        )
        : (
          <UnlinkedBody
            tagPk={tagPk}
            isMeta={isMeta}
            parent={relations.parent}
            lagoFetchFailed={lagoFetchFailed}
          />
        )}

      {showFamily && (
        <FamilyZone
          isMeta={isMeta}
          parent={relations.parent}
          childTags={relations.children}
          tagHasDirectLink={linking !== null}
        />
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------

function LinkedBody(
  {
    linking,
    tagPk,
    customerUrl,
    subscriptionUrl,
    lagoFetchFailed,
    warnLine,
  }: {
    linking: TagLinkingInfo;
    tagPk: number;
    customerUrl: string | null;
    subscriptionUrl: string | null;
    lagoFetchFailed: boolean;
    warnLine?: string | null;
  },
) {
  const customerName = linking.customerName ?? linking.lagoCustomerExternalId ??
    "—";
  // Lago sometimes returns an empty string for `subscriptionName` — fall
  // back through to the plan code (the "type", e.g. `ExpressChargeAC`).
  const planLabel =
    (linking.subscriptionName && linking.subscriptionName.trim()) ||
    (linking.subscriptionPlanCode && linking.subscriptionPlanCode.trim()) ||
    null;

  return (
    <div class="space-y-4">
      {/* Customer + subscription detail rows */}
      <dl class="grid gap-3 text-sm sm:grid-cols-2">
        <div class="space-y-0.5">
          <dt class="text-[11px] uppercase tracking-wide text-muted-foreground">
            Customer
          </dt>
          <dd class="font-medium">{customerName}</dd>
          <dd class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            {linking.customerSlug
              ? <code class="font-mono">{linking.customerSlug}</code>
              : null}
            {linking.customerSequentialId !== null
              ? <span>#{linking.customerSequentialId}</span>
              : null}
          </dd>
        </div>
        <div class="space-y-0.5">
          <dt class="text-[11px] uppercase tracking-wide text-muted-foreground">
            Subscription
          </dt>
          {planLabel
            ? (
              <>
                <dd class="flex flex-wrap items-center gap-2">
                  <PlanBadge
                    name={planLabel}
                    planCode={linking.subscriptionPlanCode ??
                      linking.lagoSubscriptionExternalId ?? planLabel}
                    size="sm"
                  />
                  {linking.subscriptionStatus
                    ? (
                      <span
                        class={cn(
                          "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
                          statusTone(linking.subscriptionStatus),
                        )}
                      >
                        {linking.subscriptionStatus}
                      </span>
                    )
                    : null}
                </dd>
                <dd class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                  {linking.subscriptionPlanCode &&
                      linking.subscriptionPlanCode !== planLabel
                    ? (
                      <code class="font-mono">
                        {linking.subscriptionPlanCode}
                      </code>
                    )
                    : null}
                  {linking.subscriptionCurrentPeriodEnd
                    ? (
                      <span>
                        ends {fmtDate(linking.subscriptionCurrentPeriodEnd)}
                      </span>
                    )
                    : null}
                </dd>
              </>
            )
            : (
              <dd>
                <Badge variant="outline" class="border-dashed">
                  No active subscription
                </Badge>
              </dd>
            )}
        </div>
      </dl>

      {lagoFetchFailed && (
        <p class="text-xs text-amber-600 dark:text-amber-400">
          Lago is unreachable — details may be stale.
        </p>
      )}
      {warnLine && (
        <div class="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
          {warnLine}
        </div>
      )}

      {/* CTAs */}
      <div class="flex flex-wrap gap-2 pt-1">
        <a
          href={`/links/${linking.mappingId}`}
          class="inline-flex h-8 flex-1 items-center justify-center gap-2 rounded-md border border-input bg-background px-3 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Pencil class="size-3.5" aria-hidden="true" />
          Edit linking
        </a>
        {customerUrl && (
          <a
            href={customerUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open customer in Lago (opens in new tab)"
            class="inline-flex h-8 flex-1 items-center justify-center gap-2 rounded-md border border-input bg-background px-3 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <User class="size-3.5" aria-hidden="true" />
            Customer in Lago
          </a>
        )}
        {subscriptionUrl && (
          <a
            href={subscriptionUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open subscription in Lago (opens in new tab)"
            class="inline-flex h-8 w-full items-center justify-center gap-2 rounded-md border border-input bg-background px-3 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ExternalLink class="size-3.5" aria-hidden="true" />
            Subscription in Lago
          </a>
        )}
      </div>

      {/* Tag pk kept for forward-compat with future deep-links. */}
      <span class="sr-only" data-tag-pk={tagPk} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function UnlinkedBody(
  { tagPk, isMeta, parent, lagoFetchFailed }: {
    tagPk: number;
    isMeta: boolean;
    parent: RelationTag | null;
    lagoFetchFailed: boolean;
  },
) {
  const inheritsFromParent = parent !== null && parent.hasLagoCustomer;
  const topLevel = parent === null;

  let summary: string;
  if (inheritsFromParent) {
    summary = isMeta
      ? "Unlinked rollup — inherits a customer from its parent"
      : "Unlinked — inherits billing from parent meta-tag";
  } else if (isMeta) {
    summary = "Unlinked rollup — no customer yet";
  } else if (topLevel) {
    summary = "Unlinked · top-level tag";
  } else {
    summary = "Unlinked — parent also has no customer";
  }

  return (
    <div class="space-y-3">
      <div class="flex flex-col items-center gap-3 py-4 text-center">
        <div
          class="flex size-14 items-center justify-center rounded-full bg-cyan-500/10 text-cyan-600 dark:text-cyan-400"
          aria-hidden="true"
        >
          <Link2 class="h-7 w-7" />
        </div>
        <div>
          <p class="text-sm font-medium">{summary}</p>
          <p class="mt-0.5 text-xs text-muted-foreground">
            {isMeta
              ? "Attach a Lago customer here to bill this rollup's children."
              : "Attach this tag to a Lago customer to bill its sessions."}
          </p>
        </div>
        <a
          href={`/links/new?tagPk=${tagPk}`}
          class="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Link2 class="h-4 w-4" aria-hidden="true" />
          Link to customer
        </a>
        {lagoFetchFailed && (
          <p class="text-xs text-amber-600 dark:text-amber-400">
            Lago is unreachable — linking status may be stale.
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function FamilyZone(
  { isMeta, parent, childTags, tagHasDirectLink }: {
    isMeta: boolean;
    parent: RelationTag | null;
    childTags: RelationTag[];
    /** Does this tag carry its own Lago customer link? Drives parent copy. */
    tagHasDirectLink: boolean;
  },
) {
  const emptyChildren = childTags.length === 0;
  // When the tag itself isn't linked but its parent is, the parent is the
  // billing source — surface that inline on the parent block instead of in
  // the narrative sentence above.
  const parentProvidesBilling = parent !== null && parent.hasLagoCustomer &&
    !tagHasDirectLink;

  return (
    <div class="mt-5 space-y-3 border-t pt-4">
      <div>
        <div class="mb-1.5 flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
          <span>Parent</span>
          {parentProvidesBilling && (
            <span class="rounded bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-700 dark:text-cyan-300">
              Billing source
            </span>
          )}
        </div>
        {parent
          ? (
            <div class="flex flex-wrap items-center gap-2">
              <TagChip
                idTag={parent.idTag}
                tagPk={parent.tagPk ?? 0}
                tagType={parent.tagType}
                displayName={parent.displayName}
                hasLagoCustomer={parent.hasLagoCustomer}
                href={parent.tagPk !== null ? undefined : null}
              />
              {parentProvidesBilling && (
                <span class="text-xs text-muted-foreground">
                  This tag inherits billing from its parent.
                </span>
              )}
            </div>
          )
          : (
            <div class="flex items-center gap-2 text-xs text-muted-foreground">
              <Link2Off class="size-3.5" aria-hidden="true" />
              <span>No parent — top-level tag.</span>
            </div>
          )}
      </div>

      {(isMeta || !emptyChildren) && (
        <div>
          <div class="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
            Children
          </div>
          {emptyChildren
            ? (
              <p class="text-xs text-muted-foreground">
                {isMeta
                  ? "No children yet — child tags inherit from a meta-tag via StEvE's parentIdTag."
                  : "None."}
              </p>
            )
            : (
              <div class="flex flex-wrap gap-2">
                {childTags.map((c) => (
                  <TagChip
                    key={c.idTag}
                    idTag={c.idTag}
                    tagPk={c.tagPk ?? 0}
                    tagType={c.tagType}
                    displayName={c.displayName}
                    hasLagoCustomer={c.hasLagoCustomer}
                    isChild
                    href={c.tagPk !== null ? undefined : null}
                  />
                ))}
              </div>
            )}
        </div>
      )}
    </div>
  );
}

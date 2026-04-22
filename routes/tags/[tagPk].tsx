import { define } from "../../utils.ts";
import { db } from "../../src/db/index.ts";
import * as schema from "../../src/db/schema.ts";
import { desc, eq, sql } from "drizzle-orm";
import { SidebarLayout } from "../../components/SidebarLayout.tsx";
import { PageCard } from "../../components/PageCard.tsx";
import TagMetadataForm from "../../islands/TagMetadataForm.tsx";
import { steveClient } from "../../src/lib/steve-client.ts";
import { lagoClient } from "../../src/lib/lago-client.ts";
import { config } from "../../src/lib/config.ts";
import { getAllChildTags, isMetaTag } from "../../src/lib/tag-hierarchy.ts";
import { ArrowLeft } from "lucide-preact";
import { CHROME_SIZE } from "../../components/AppSidebar.tsx";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.tsx";
import { TagHeaderStrip } from "../../components/tags/TagHeaderStrip.tsx";
import {
  TagLinkingCard,
  type TagLinkingInfo,
} from "../../components/tags/TagLinkingCard.tsx";
import {
  type IssuedCardRow,
  IssuedCardsSection,
} from "../../components/tags/IssuedCardsSection.tsx";
import {
  type RecentTransactionRow,
  TagRecentTransactionsSection,
} from "../../components/tags/TagRecentTransactionsSection.tsx";
import {
  type RelationTag,
  TagRelationsSection,
} from "../../components/tags/TagRelationsSection.tsx";
import type {
  LagoCustomer,
  LagoSubscription,
} from "../../src/lib/types/lago.ts";
import type { StEvEOcppTag } from "../../src/lib/types/steve.ts";

interface LoaderData {
  tagPk: number;
  idTag: string;
  parentIdTag: string | null;
  isMeta: boolean;
  hasMapping: boolean;
  mappingId: number | null;
  initialMetadata: {
    displayName: string | null;
    notes: string | null;
    tagType: string | null;
    isActive: boolean | null;
  };
  header: {
    displayName: string | null;
    tagType: string | null;
    isActive: boolean;
    isLinked: boolean;
  };
  linking: TagLinkingInfo | null;
  issuedCards: IssuedCardRow[];
  issuedCardsMissing: boolean;
  recentTransactions: RecentTransactionRow[];
  relations: {
    hasAny: boolean;
    parent: RelationTag | null;
    children: RelationTag[];
  };
  hasLagoCustomer: boolean;
  mappingLabel: string | null;
  steveFetchFailed: boolean;
  lagoFetchFailed: boolean;
  lagoDashboardUrl: string;
}

function buildInvoiceUrl(
  dashboardUrl: string,
  lagoCustomerLagoId: string | null,
  lagoInvoiceId: string | null,
): string | null {
  if (!dashboardUrl || !lagoCustomerLagoId || !lagoInvoiceId) return null;
  return `${dashboardUrl}/customer/${lagoCustomerLagoId}/invoice/${lagoInvoiceId}/overview`;
}

export const handler = define.handlers({
  async GET(ctx) {
    const tagPk = parseInt(ctx.params.tagPk);
    if (!Number.isFinite(tagPk)) {
      return ctx.redirect("/tags");
    }

    // -----------------------------------------------------------------
    // 1. StEvE tags (filter in memory — no per-tag endpoint).
    // -----------------------------------------------------------------
    let allTags: StEvEOcppTag[] = [];
    let steveFetchFailed = false;
    try {
      allTags = await steveClient.getOcppTags();
    } catch (err) {
      steveFetchFailed = true;
      console.error("[tags/[tagPk]] StEvE fetch failed:", err);
    }

    const steveTag = allTags.find((t) => t.ocppTagPk === tagPk);
    if (!steveTag && !steveFetchFailed) {
      // StEvE returned a list and this tag isn't in it → 404-ish.
      return ctx.redirect("/tags");
    }

    // Fallback idTag when StEvE is down but we still want to render.
    // In that case the mapping row carries it.
    // -----------------------------------------------------------------
    // 2. Local mapping.
    // -----------------------------------------------------------------
    const [mapping] = await db
      .select()
      .from(schema.userMappings)
      .where(eq(schema.userMappings.steveOcppTagPk, tagPk))
      .limit(1);

    if (!steveTag && !mapping) {
      return ctx.redirect("/tags");
    }

    const resolvedIdTag = steveTag?.idTag ?? mapping?.steveOcppIdTag ?? "";
    const resolvedParent = steveTag?.parentIdTag ?? null;
    const isMeta = isMetaTag(resolvedIdTag);

    // -----------------------------------------------------------------
    // 3. Lago customer + subscription — tolerate failures.
    // -----------------------------------------------------------------
    let lagoCustomer: LagoCustomer | null = null;
    let lagoSubscription: LagoSubscription | null = null;
    let lagoFetchFailed = false;

    if (mapping?.lagoCustomerExternalId) {
      try {
        const customerRes = await lagoClient.getCustomer(
          mapping.lagoCustomerExternalId,
        );
        lagoCustomer = customerRes.customer;

        const { subscriptions } = await lagoClient.getSubscriptions(
          mapping.lagoCustomerExternalId,
        );
        if (mapping.lagoSubscriptionExternalId) {
          lagoSubscription = subscriptions.find((s) =>
            s.external_id === mapping.lagoSubscriptionExternalId
          ) ?? null;
        }
        // Fall through: pick the first active subscription if the mapping
        // doesn't name one (or the named one is gone).
        if (!lagoSubscription) {
          lagoSubscription = subscriptions.find((s) => s.status === "active") ??
            null;
        }
      } catch (err) {
        lagoFetchFailed = true;
        console.error("[tags/[tagPk]] Lago fetch failed:", err);
      }
    }

    // -----------------------------------------------------------------
    // 4. Issued cards — tolerate missing migration.
    // -----------------------------------------------------------------
    let issuedCardRows: Array<{
      id: number;
      cardType: string;
      billingMode: string;
      issuedAt: Date | null;
      issuedBy: string | null;
      issuedByEmail: string | null;
      note: string | null;
      lagoInvoiceId: string | null;
      syncError: string | null;
    }> = [];
    let issuedCardsMissing = false;

    if (mapping) {
      try {
        const rows = await db
          .select({
            id: schema.issuedCards.id,
            cardType: schema.issuedCards.cardType,
            billingMode: schema.issuedCards.billingMode,
            issuedAt: schema.issuedCards.issuedAt,
            issuedBy: schema.issuedCards.issuedBy,
            issuedByEmail: schema.users.email,
            note: schema.issuedCards.note,
            lagoInvoiceId: schema.issuedCards.lagoInvoiceId,
            syncError: schema.issuedCards.syncError,
          })
          .from(schema.issuedCards)
          .leftJoin(
            schema.users,
            eq(schema.issuedCards.issuedBy, schema.users.id),
          )
          .where(eq(schema.issuedCards.userMappingId, mapping.id))
          .orderBy(desc(schema.issuedCards.issuedAt));
        issuedCardRows = rows;
      } catch (err) {
        // Most commonly the table doesn't exist yet (migration 0011 pending).
        issuedCardsMissing = true;
        console.error("[tags/[tagPk]] issued_cards query failed:", err);
      }
    }

    const lagoCustomerLagoId = lagoCustomer?.lago_id ?? null;
    const dashboardUrl = config.LAGO_DASHBOARD_URL;
    const issuedCards: IssuedCardRow[] = issuedCardRows.map((r) => ({
      id: r.id,
      cardType: r.cardType,
      billingMode: r.billingMode,
      issuedAt: r.issuedAt
        ? r.issuedAt.toISOString()
        : new Date(0).toISOString(),
      issuedByEmail: r.issuedByEmail ?? null,
      note: r.note,
      lagoInvoiceId: r.lagoInvoiceId,
      lagoInvoiceUrl: buildInvoiceUrl(
        dashboardUrl,
        lagoCustomerLagoId,
        r.lagoInvoiceId,
      ),
      syncError: r.syncError,
    }));

    // -----------------------------------------------------------------
    // 5. Recent StEvE transactions + lastSyncedAt join.
    // -----------------------------------------------------------------
    let recentTransactions: RecentTransactionRow[] = [];
    if (resolvedIdTag && !steveFetchFailed) {
      try {
        const txs = await steveClient.getTransactions({
          ocppIdTag: resolvedIdTag,
        });
        // StEvE returns newest first typically, but re-sort defensively.
        const sorted = [...txs].sort((a, b) => {
          const at = new Date(a.startTimestamp).getTime();
          const bt = new Date(b.startTimestamp).getTime();
          return bt - at;
        });
        const last10 = sorted.slice(0, 10);
        const txIds = last10.map((t) => t.id);

        // Latest synced event per steve transaction id.
        let syncedByTxId = new Map<number, string>();
        if (txIds.length > 0) {
          try {
            const syncedRows = await db
              .select({
                steveTransactionId:
                  schema.syncedTransactionEvents.steveTransactionId,
                syncedAt: sql<
                  Date
                >`max(${schema.syncedTransactionEvents.syncedAt})`,
              })
              .from(schema.syncedTransactionEvents)
              .where(
                sql`${schema.syncedTransactionEvents.steveTransactionId} = ANY(${txIds})`,
              )
              .groupBy(schema.syncedTransactionEvents.steveTransactionId);
            for (const row of syncedRows) {
              if (row.syncedAt) {
                syncedByTxId.set(
                  row.steveTransactionId,
                  row.syncedAt instanceof Date
                    ? row.syncedAt.toISOString()
                    : String(row.syncedAt),
                );
              }
            }
          } catch (err) {
            console.error("[tags/[tagPk]] synced_events join failed:", err);
            syncedByTxId = new Map();
          }
        }

        recentTransactions = last10.map((t) => {
          const startWh = parseInt(t.startValue);
          const stopWh = t.stopValue !== null ? parseInt(t.stopValue) : null;
          const kwhDelivered = stopWh !== null && Number.isFinite(startWh) &&
              Number.isFinite(stopWh)
            ? Math.max(0, (stopWh - startWh) / 1000)
            : null;
          return {
            steveTransactionId: t.id,
            chargeBoxId: t.chargeBoxId,
            connectorId: t.connectorId,
            startedAt: t.startTimestamp,
            stoppedAt: t.stopTimestamp,
            kwhDelivered,
            lastSyncedAt: syncedByTxId.get(t.id) ?? null,
          };
        });
      } catch (err) {
        console.error("[tags/[tagPk]] getTransactions failed:", err);
      }
    }

    // -----------------------------------------------------------------
    // 6. Parent + children from the StEvE hierarchy.
    //    We additionally annotate each related tag with local mapping
    //    info (tagPk, tagType, displayName, hasLagoCustomer) so the
    //    TagChip renders usefully.
    // -----------------------------------------------------------------
    const relatedIdTags = new Set<string>();
    if (resolvedParent) relatedIdTags.add(resolvedParent);
    const childStEvE = steveTag ? getAllChildTags(steveTag.idTag, allTags) : [];
    for (const c of childStEvE) relatedIdTags.add(c.idTag);

    let relatedMappings: schema.UserMapping[] = [];
    if (relatedIdTags.size > 0) {
      try {
        relatedMappings = await db
          .select()
          .from(schema.userMappings)
          .where(
            sql`${schema.userMappings.steveOcppIdTag} = ANY(${
              Array.from(relatedIdTags)
            })`,
          );
      } catch (err) {
        console.error("[tags/[tagPk]] related mappings query failed:", err);
      }
    }
    const mappingByIdTag = new Map<string, schema.UserMapping>();
    for (const m of relatedMappings) {
      mappingByIdTag.set(m.steveOcppIdTag, m);
    }

    const parentTag: RelationTag | null = resolvedParent
      ? (() => {
        const stv = allTags.find((t) => t.idTag === resolvedParent);
        const mp = mappingByIdTag.get(resolvedParent);
        return {
          idTag: resolvedParent,
          tagPk: stv?.ocppTagPk ?? null,
          tagType: mp?.tagType ?? null,
          displayName: mp?.displayName ?? null,
          hasLagoCustomer: Boolean(mp?.lagoCustomerExternalId),
        };
      })()
      : null;

    const childrenRel: RelationTag[] = childStEvE.map((c) => {
      const mp = mappingByIdTag.get(c.idTag);
      return {
        idTag: c.idTag,
        tagPk: c.ocppTagPk,
        tagType: mp?.tagType ?? null,
        displayName: mp?.displayName ?? null,
        hasLagoCustomer: Boolean(mp?.lagoCustomerExternalId),
      };
    });

    // -----------------------------------------------------------------
    // 7. Header + linking card inputs.
    // -----------------------------------------------------------------
    const hasLagoCustomer = Boolean(mapping?.lagoCustomerExternalId);
    const linking: TagLinkingInfo | null = mapping?.lagoCustomerExternalId
      ? {
        mappingId: mapping.id,
        lagoCustomerExternalId: mapping.lagoCustomerExternalId,
        lagoCustomerLagoId: lagoCustomer?.lago_id ?? null,
        customerName: lagoCustomer?.name ?? mapping.displayName ?? null,
        customerSlug: lagoCustomer?.slug ?? null,
        customerSequentialId: lagoCustomer?.sequential_id ?? null,
        lagoSubscriptionExternalId: mapping.lagoSubscriptionExternalId,
        lagoSubscriptionLagoId: lagoSubscription?.lago_id ?? null,
        subscriptionName: lagoSubscription?.name ?? null,
        subscriptionPlanCode: lagoSubscription?.plan_code ?? null,
        subscriptionStatus: lagoSubscription?.status ?? null,
        subscriptionCurrentPeriodEnd:
          lagoSubscription?.current_billing_period_ending_at ?? null,
        billingTier: mapping.billingTier ?? "standard",
      }
      : null;

    const data: LoaderData = {
      tagPk,
      idTag: resolvedIdTag,
      parentIdTag: resolvedParent,
      isMeta,
      hasMapping: Boolean(mapping),
      mappingId: mapping?.id ?? null,
      initialMetadata: {
        displayName: mapping?.displayName ?? null,
        notes: mapping?.notes ?? null,
        tagType: mapping?.tagType ?? null,
        isActive: mapping?.isActive ?? null,
      },
      header: {
        displayName: mapping?.displayName ?? null,
        tagType: mapping?.tagType ?? null,
        isActive: mapping?.isActive ?? true,
        isLinked: Boolean(mapping?.lagoCustomerExternalId),
      },
      linking,
      issuedCards,
      issuedCardsMissing,
      recentTransactions,
      relations: {
        hasAny: Boolean(parentTag) || childrenRel.length > 0,
        parent: parentTag,
        children: childrenRel,
      },
      hasLagoCustomer,
      mappingLabel: mapping?.displayName ?? resolvedIdTag,
      steveFetchFailed,
      lagoFetchFailed,
      lagoDashboardUrl: config.LAGO_DASHBOARD_URL,
    };

    return { data };
  },
});

function BackAction() {
  return (
    <a
      href="/tags"
      className="flex items-center justify-center gap-2 px-4 transition-colors"
      style={{ height: CHROME_SIZE }}
    >
      <ArrowLeft className="size-5" />
      <span className="text-sm font-medium">Back</span>
    </a>
  );
}

export default define.page<typeof handler>(
  function TagDetailsPage({ data, url, state }) {
    const {
      tagPk,
      idTag,
      parentIdTag,
      isMeta,
      mappingId,
      initialMetadata,
      header,
      linking,
      issuedCards,
      issuedCardsMissing,
      recentTransactions,
      relations,
      hasLagoCustomer,
      mappingLabel,
      steveFetchFailed,
      lagoFetchFailed,
      lagoDashboardUrl,
    } = data;

    const relationsSection = (
      <TagRelationsSection
        isMeta={isMeta}
        parent={relations.parent}
        childTags={relations.children}
      />
    );

    return (
      <SidebarLayout
        currentPath={url.pathname}
        user={state.user}
        accentColor="cyan"
        actions={<BackAction />}
      >
        <PageCard
          title={isMeta ? "Meta-tag details" : "Tag details"}
          description={isMeta
            ? "Meta-tags group multiple real tags under one customer. Edit the rollup's metadata here; child tags inherit via StEvE's parentIdTag."
            : "Identity, metadata, linking, issued cards, and recent charging for this tag."}
          colorScheme="cyan"
        >
          <div class="space-y-6">
            {steveFetchFailed
              ? (
                <div
                  role="status"
                  aria-live="polite"
                  class="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400"
                >
                  StEvE is unreachable right now — charging history and
                  hierarchy may be stale.
                </div>
              )
              : null}

            <TagHeaderStrip
              idTag={idTag}
              displayName={header.displayName}
              tagType={header.tagType}
              isMeta={isMeta}
              isLinked={header.isLinked}
              isActive={header.isActive}
              parentIdTag={parentIdTag}
            />

            {/* 2-col split: metadata (2fr) + linking (1fr) at lg+. */}
            <div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <Card class="lg:col-span-2">
                <CardHeader>
                  <CardTitle class="text-base">Metadata</CardTitle>
                </CardHeader>
                <CardContent>
                  <TagMetadataForm
                    ocppTagPk={tagPk}
                    ocppIdTag={idTag}
                    initial={initialMetadata}
                  />
                </CardContent>
              </Card>

              <div class="lg:col-span-1">
                <TagLinkingCard
                  tagPk={tagPk}
                  linking={linking}
                  lagoDashboardUrl={lagoDashboardUrl}
                  lagoFetchFailed={lagoFetchFailed}
                />
              </div>
            </div>

            {/* Meta-tag variant: hierarchy promoted above issued cards. */}
            {isMeta ? relationsSection : null}

            <IssuedCardsSection
              tagPk={tagPk}
              mappingId={mappingId}
              mappingLabel={mappingLabel}
              hasLagoCustomer={hasLagoCustomer}
              isMeta={isMeta}
              rows={issuedCards}
              issuedCardsMissing={issuedCardsMissing}
            />

            <TagRecentTransactionsSection
              idTag={idTag}
              rows={recentTransactions}
              steveFetchFailed={steveFetchFailed}
            />

            {/* Non-meta: render hierarchy only when non-empty. */}
            {!isMeta && relations.hasAny ? relationsSection : null}
          </div>
        </PageCard>
      </SidebarLayout>
    );
  },
);

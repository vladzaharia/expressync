import { define } from "../../utils.ts";
import { db } from "../../src/db/index.ts";
import * as schema from "../../src/db/schema.ts";
import { eq, sql } from "drizzle-orm";
import { SidebarLayout } from "../../components/SidebarLayout.tsx";
import { PageCard } from "../../components/PageCard.tsx";
import TagMetadataForm from "../../islands/TagMetadataForm.tsx";
import { steveClient } from "../../src/lib/steve-client.ts";
import { lagoClient } from "../../src/lib/lago-client.ts";
import { config } from "../../src/lib/config.ts";
import { getAllChildTags, isMetaTag } from "../../src/lib/tag-hierarchy.ts";
import { BackAction } from "../../components/shared/BackAction.tsx";
import { SectionCard } from "../../components/shared/SectionCard.tsx";
import { FileText } from "lucide-preact";
import { TagHeaderStrip } from "../../components/tags/TagHeaderStrip.tsx";
import {
  type RelationTag,
  TagLinkCard,
  type TagLinkingInfo,
} from "../../components/tags/TagLinkCard.tsx";
import {
  type RecentTransactionRow,
  TagRecentTransactionsSection,
} from "../../components/tags/TagRecentTransactionsSection.tsx";
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
    // 4. Recent StEvE transactions + lastSyncedAt join.
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

export default define.page<typeof handler>(
  function TagDetailsPage({ data, url, state }) {
    const {
      tagPk,
      idTag,
      parentIdTag,
      isMeta,
      initialMetadata,
      header,
      linking,
      recentTransactions,
      relations,
      steveFetchFailed,
      lagoFetchFailed,
      lagoDashboardUrl,
    } = data;

    return (
      <SidebarLayout
        currentPath={url.pathname}
        user={state.user}
        accentColor="cyan"
        actions={<BackAction href="/tags" />}
      >
        <PageCard
          title={isMeta ? "Meta-tag details" : "Tag details"}
          description={isMeta
            ? "Meta-tags group multiple real tags under one customer. Edit the rollup's metadata here; child tags inherit via StEvE's parentIdTag."
            : "Identity, metadata, linking, and recent charging for this tag."}
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
              <SectionCard
                title="Metadata"
                icon={FileText}
                accent="cyan"
                className="lg:col-span-2"
              >
                <TagMetadataForm
                  ocppTagPk={tagPk}
                  ocppIdTag={idTag}
                  initial={initialMetadata}
                />
              </SectionCard>

              <div class="lg:col-span-1">
                <TagLinkCard
                  tagPk={tagPk}
                  isMeta={isMeta}
                  linking={linking}
                  relations={relations}
                  lagoDashboardUrl={lagoDashboardUrl}
                  lagoFetchFailed={lagoFetchFailed}
                />
              </div>
            </div>

            <TagRecentTransactionsSection
              idTag={idTag}
              rows={recentTransactions}
              steveFetchFailed={steveFetchFailed}
            />
          </div>
        </PageCard>
      </SidebarLayout>
    );
  },
);

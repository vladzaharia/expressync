import { define } from "../../../utils.ts";
import { db } from "../../../src/db/index.ts";
import * as schema from "../../../src/db/schema.ts";
import { eq, inArray } from "drizzle-orm";
import { SidebarLayout } from "../../../components/SidebarLayout.tsx";
import { PageCard } from "../../../components/PageCard.tsx";
import MappingForm from "../../../islands/MappingForm.tsx";
import { BackAction } from "../../../components/shared/BackAction.tsx";
import { SectionCard } from "../../../components/shared/SectionCard.tsx";
import { Settings } from "lucide-preact";
import { getAllChildTags, isMetaTag } from "../../../src/lib/tag-hierarchy.ts";
import { config } from "../../../src/lib/config.ts";
import { lagoClient } from "../../../src/lib/lago-client.ts";
import { steveClient } from "../../../src/lib/steve-client.ts";
import { LinkingHeaderStrip } from "../../../components/links/LinkingHeaderStrip.tsx";
import { LinkageSummaryCard } from "../../../components/links/LinkageSummaryCard.tsx";
import {
  RecentActivityMini,
  type RecentActivityRow,
} from "../../../components/links/RecentActivityMini.tsx";
import LinkingDangerZone from "../../../components/links/LinkingDangerZone.tsx";
import ScanAnotherForCustomer from "../../../islands/linking/ScanAnotherForCustomer.tsx";

/**
 * Loader shape (LinksEditLoaderData):
 *   mapping             — DB row
 *   lagoCustomer        — Lago lookup (nullable on error)
 *   lagoSubscription    — Lago lookup (nullable)
 *   recentTransactions  — last 5 sessions for this ocppIdTag
 *   isMeta              — derived
 *   cascadeCount        — 1 + child-mapping count (for delete copy)
 */
export const handler = define.handlers({
  async GET(ctx) {
    const id = parseInt(ctx.params.id);
    if (isNaN(id)) {
      return ctx.redirect("/links");
    }

    const [mapping] = await db
      .select()
      .from(schema.userMappings)
      .where(eq(schema.userMappings.id, id))
      .limit(1);

    if (!mapping) {
      return ctx.redirect("/links");
    }

    // Lago customer + subscription — best-effort.
    let lagoCustomer: {
      externalId: string;
      lagoId: string;
      name: string;
      email: string | null;
    } | null = null;
    let lagoSubscription: {
      externalId: string;
      lagoId: string;
      name: string;
      planCode: string;
      status: string;
    } | null = null;

    try {
      if (mapping.lagoCustomerExternalId) {
        const { customers } = await lagoClient.getCustomers();
        const hit = customers.find(
          (c) => c.external_id === mapping.lagoCustomerExternalId,
        );
        if (hit) {
          lagoCustomer = {
            externalId: hit.external_id,
            lagoId: hit.lago_id,
            name: hit.name || hit.external_id,
            email: hit.email ?? null,
          };
        }
      }
      if (mapping.lagoSubscriptionExternalId) {
        const { subscriptions } = await lagoClient.getSubscriptions();
        const hit = subscriptions.find(
          (s) => s.external_id === mapping.lagoSubscriptionExternalId,
        );
        if (hit) {
          lagoSubscription = {
            externalId: hit.external_id,
            lagoId: hit.lago_id,
            name: hit.name || hit.plan_code,
            planCode: hit.plan_code,
            status: hit.status,
          };
        }
      }
    } catch (err) {
      console.error("Failed to fetch Lago data for mapping:", err);
    }

    // Recent transactions via StEvE — filtered by ocppIdTag. Best-effort:
    // a StEvE outage should not crash the page.
    let recentTransactions: RecentActivityRow[] = [];
    try {
      const txs = await steveClient.getTransactions({
        ocppIdTag: mapping.steveOcppIdTag,
      });
      const sliced = txs
        .sort((a, b) =>
          new Date(b.startTimestamp).getTime() -
          new Date(a.startTimestamp).getTime()
        )
        .slice(0, 5);

      // Enrich with friendly names from chargers_cache so the activity rows
      // can render the operator-set description as the primary label.
      const ids = Array.from(new Set(sliced.map((t) => t.chargeBoxId)));
      const friendlyByCbid = new Map<string, string | null>();
      if (ids.length > 0) {
        try {
          const cacheRows = await db
            .select({
              chargeBoxId: schema.chargersCache.chargeBoxId,
              friendlyName: schema.chargersCache.friendlyName,
            })
            .from(schema.chargersCache)
            .where(inArray(schema.chargersCache.chargeBoxId, ids));
          for (const r of cacheRows) {
            friendlyByCbid.set(r.chargeBoxId, r.friendlyName);
          }
        } catch (err) {
          console.error("Failed to load friendly names for activity:", err);
        }
      }

      recentTransactions = sliced.map((tx) => {
        const startWh = Number(tx.startValue);
        const stopWh = tx.stopValue == null ? null : Number(tx.stopValue);
        const kwh = stopWh != null && Number.isFinite(startWh) &&
            Number.isFinite(stopWh)
          ? Math.max(0, (stopWh - startWh) / 1000)
          : null;
        return {
          id: tx.id,
          startTimestamp: tx.startTimestamp,
          stopTimestamp: tx.stopTimestamp,
          kwh,
          chargeBoxId: tx.chargeBoxId,
          friendlyName: friendlyByCbid.get(tx.chargeBoxId) ?? null,
        };
      });
    } catch (err) {
      console.error("Failed to fetch recent transactions:", err);
    }

    // Cascade count for the delete dialog (1 self + child count).
    let cascadeCount = 1;
    try {
      const allTags = await steveClient.getOcppTags();
      cascadeCount = 1 +
        getAllChildTags(mapping.steveOcppIdTag, allTags).length;
    } catch (err) {
      console.error("Failed to compute cascade count:", err);
    }

    return {
      data: {
        mapping,
        lagoCustomer,
        lagoSubscription,
        recentTransactions,
        isMeta: isMetaTag(mapping.steveOcppIdTag),
        cascadeCount,
      },
    };
  },
});

export default define.page<typeof handler>(
  function EditTagLinkingPage({ data, url, state }) {
    const { mapping, lagoCustomer, lagoSubscription, recentTransactions } =
      data;
    const hasLagoCustomer = Boolean(mapping.lagoCustomerExternalId);
    const meta = data.isMeta;

    const lagoDashboardUrl = config.LAGO_DASHBOARD_URL || null;
    const customerLagoUrl = lagoCustomer && lagoDashboardUrl
      ? `${lagoDashboardUrl}/customer/${lagoCustomer.lagoId}`
      : null;
    const subscriptionLagoUrl =
      lagoCustomer && lagoSubscription && lagoDashboardUrl
        ? `${lagoDashboardUrl}/customer/${lagoCustomer.lagoId}/subscription/${lagoSubscription.lagoId}/overview`
        : null;

    const billingTier: "standard" | "comped" = mapping.billingTier === "comped"
      ? "comped"
      : "standard";

    return (
      <SidebarLayout
        currentPath={url.pathname}
        user={state.user}
        accentColor="violet"
        actions={<BackAction href="/links" />}
      >
        <PageCard
          title={meta ? "Edit meta-tag link" : "Edit tag link"}
          description={meta
            ? "Meta-tags (OCPP-*) group multiple real tags under one customer — they don't correspond to a physical card."
            : "Update the billing configuration for this OCPP tag."}
          colorScheme="violet"
        >
          <div class="space-y-6">
            <LinkingHeaderStrip
              idTag={mapping.steveOcppIdTag}
              tagType={mapping.tagType}
              isMeta={meta}
              isActive={mapping.isActive ?? true}
              customer={lagoCustomer
                ? {
                  externalId: lagoCustomer.externalId,
                  name: lagoCustomer.name,
                  lagoUrl: customerLagoUrl,
                }
                : null}
              subscription={lagoSubscription
                ? {
                  externalId: lagoSubscription.externalId,
                  name: lagoSubscription.name,
                  lagoUrl: subscriptionLagoUrl,
                }
                : null}
              tagPk={mapping.steveOcppTagPk}
            />

            <SectionCard
              title="Billing configuration"
              description={meta
                ? "Meta-tag rollup — child tags inherit this customer"
                : "Customer + subscription that this tag bills to"}
              icon={Settings}
              accent="violet"
            >
              <MappingForm
                mapping={{
                  id: mapping.id,
                  steveOcppIdTag: mapping.steveOcppIdTag,
                  steveOcppTagPk: mapping.steveOcppTagPk,
                  lagoCustomerExternalId: mapping.lagoCustomerExternalId,
                  lagoSubscriptionExternalId:
                    mapping.lagoSubscriptionExternalId,
                  isActive: mapping.isActive,
                }}
                lagoDashboardUrl={lagoDashboardUrl}
              />
            </SectionCard>

            <LinkageSummaryCard
              idTag={mapping.steveOcppIdTag}
              tagPk={mapping.steveOcppTagPk}
              customer={lagoCustomer
                ? {
                  externalId: lagoCustomer.externalId,
                  name: lagoCustomer.name,
                  lagoUrl: customerLagoUrl,
                }
                : null}
              subscription={lagoSubscription
                ? {
                  externalId: lagoSubscription.externalId,
                  name: lagoSubscription.name,
                  lagoUrl: subscriptionLagoUrl,
                }
                : null}
            />

            <div class="grid gap-6 lg:grid-cols-2">
              <RecentActivityMini
                rows={recentTransactions}
                tagPk={mapping.steveOcppTagPk}
              />
              {hasLagoCustomer && mapping.lagoCustomerExternalId
                ? (
                  <ScanAnotherForCustomer
                    customerExternalId={mapping.lagoCustomerExternalId}
                  />
                )
                : null}
            </div>

            <LinkingDangerZone
              mappingId={mapping.id}
              isActive={mapping.isActive ?? true}
              billingTier={billingTier}
              isMeta={meta}
              cascadeCount={data.cascadeCount}
              idTag={mapping.steveOcppIdTag}
            />
          </div>
        </PageCard>
      </SidebarLayout>
    );
  },
);

import { define } from "../../utils.ts";
import { db } from "../../src/db/index.ts";
import * as schema from "../../src/db/schema.ts";
import { eq } from "drizzle-orm";
import { SidebarLayout } from "../../components/SidebarLayout.tsx";
import { PageCard } from "../../components/PageCard.tsx";
import MappingForm from "../../islands/MappingForm.tsx";
import MappingIssueCardAction from "../../islands/MappingIssueCardAction.tsx";
import { ArrowLeft } from "lucide-preact";
import { CHROME_SIZE } from "../../components/AppSidebar.tsx";
import { getAllChildTags, isMetaTag } from "../../src/lib/tag-hierarchy.ts";
import { config } from "../../src/lib/config.ts";
import { lagoClient } from "../../src/lib/lago-client.ts";
import { steveClient } from "../../src/lib/steve-client.ts";
import { LinkingHeaderStrip } from "../../components/links/LinkingHeaderStrip.tsx";
import { LinkageSummaryCard } from "../../components/links/LinkageSummaryCard.tsx";
import {
  RecentActivityMini,
  type RecentActivityRow,
} from "../../components/links/RecentActivityMini.tsx";
import LinkingDangerZone from "../../components/links/LinkingDangerZone.tsx";
import ScanAnotherForCustomer from "../../islands/linking/ScanAnotherForCustomer.tsx";

/**
 * Loader shape (LinksEditLoaderData):
 *   mapping             — DB row
 *   lagoCustomer        — Lago lookup (nullable on error)
 *   lagoSubscription    — Lago lookup (nullable)
 *   recentTransactions  — last 5 sessions for this ocppIdTag
 *   cardsIssued         — integer from DB (mapping.cardsIssued)
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
      recentTransactions = txs
        .sort((a, b) =>
          new Date(b.startTimestamp).getTime() -
          new Date(a.startTimestamp).getTime()
        )
        .slice(0, 5)
        .map((tx) => {
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
          };
        });
    } catch (err) {
      console.error("Failed to fetch recent transactions:", err);
    }

    // Cascade count for the delete dialog (1 self + child count).
    let cascadeCount = 1;
    try {
      const allTags = await steveClient.getOcppTags();
      cascadeCount = 1 + getAllChildTags(mapping.steveOcppIdTag, allTags).length;
    } catch (err) {
      console.error("Failed to compute cascade count:", err);
    }

    return {
      data: {
        mapping,
        lagoCustomer,
        lagoSubscription,
        recentTransactions,
        cardsIssued: mapping.cardsIssued ?? 0,
        isMeta: isMetaTag(mapping.steveOcppIdTag),
        cascadeCount,
      },
    };
  },
});

function BackAction() {
  return (
    <a
      href="/links"
      className="flex items-center justify-center gap-2 px-4 transition-colors"
      style={{ height: CHROME_SIZE }}
    >
      <ArrowLeft className="size-5" />
      <span className="text-sm font-medium">Back</span>
    </a>
  );
}

export default define.page<typeof handler>(
  function EditTagLinkingPage({ data, url, state }) {
    const { mapping, lagoCustomer, lagoSubscription, recentTransactions } =
      data;
    const mappingLabel = mapping.displayName ?? mapping.steveOcppIdTag;
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

    const billingTier: "standard" | "comped" =
      mapping.billingTier === "comped" ? "comped" : "standard";

    return (
      <SidebarLayout
        currentPath={url.pathname}
        user={state.user}
        accentColor="violet"
        actions={<BackAction />}
      >
        <PageCard
          title={meta ? "Edit meta-tag link" : "Edit tag link"}
          description={meta
            ? "Meta-tags (OCPP-*) group multiple real tags under one customer — they don't correspond to a physical card."
            : "Update the billing configuration for this OCPP tag."}
          colorScheme="violet"
          headerActions={
            <MappingIssueCardAction
              userMappingId={mapping.id}
              mappingLabel={mappingLabel}
              hasLagoCustomer={hasLagoCustomer}
              isMeta={meta}
            />
          }
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
              cardsIssued={data.cardsIssued}
              tagPk={mapping.steveOcppTagPk}
            />

            <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
              <section>
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
              </section>
              <aside class="space-y-4">
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
                <RecentActivityMini
                  rows={recentTransactions}
                  tagPk={mapping.steveOcppTagPk}
                />
                {/* Scan another tag that should bill the same customer.
                    Only shown once a Lago customer is actually linked. */}
                {hasLagoCustomer && mapping.lagoCustomerExternalId
                  ? (
                    <ScanAnotherForCustomer
                      customerExternalId={mapping.lagoCustomerExternalId}
                    />
                  )
                  : null}
              </aside>
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

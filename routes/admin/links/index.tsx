import { define } from "../../../utils.ts";
import { db } from "../../../src/db/index.ts";
import * as schema from "../../../src/db/schema.ts";
import { SidebarLayout } from "../../../components/SidebarLayout.tsx";
import { Plus } from "lucide-preact";
import TagLinkingGrid from "../../../islands/TagLinkingGrid.tsx";
import { config } from "../../../src/lib/config.ts";
import { lagoClient } from "../../../src/lib/lago-client.ts";
import { PageCard } from "../../../components/PageCard.tsx";
import { CHROME_SIZE } from "../../../components/AppSidebar.tsx";
import { LinkingStatStrip } from "../../../components/links/LinkingStatStrip.tsx";
import { LinkingEmptyState } from "../../../components/links/LinkingEmptyState.tsx";
import { isMetaTag } from "../../../src/lib/tag-hierarchy.ts";
import { steveClient } from "../../../src/lib/steve-client.ts";

/**
 * Tag Linking — list page.
 *
 * Loader shape (matches `LinksIndexLoaderData` in the refactor plan):
 *   mappings           — DB user_mappings rows
 *   subscriptionNames  — Lago external_id → display-name
 *   customerLagoIds    — Lago external_id → Lago internal id (for URL building)
 *   subscriptionLagoIds — same, for subscriptions
 *   totals             — derived stats for `LinkingStatStrip`
 */

export const handler = define.handlers({
  async GET(_ctx) {
    const mappings = await db.select().from(schema.userMappings);

    const subscriptionNames = new Map<string, string>();
    const customerLagoIds = new Map<string, string>();
    const subscriptionLagoIds = new Map<string, string>();

    try {
      const { customers } = await lagoClient.getCustomers();
      for (const customer of customers) {
        customerLagoIds.set(customer.external_id, customer.lago_id);
      }

      const { subscriptions } = await lagoClient.getSubscriptions();
      for (const sub of subscriptions) {
        subscriptionNames.set(sub.external_id, sub.name || sub.plan_code);
        subscriptionLagoIds.set(sub.external_id, sub.lago_id);
      }
    } catch (error) {
      console.error("Failed to fetch Lago data:", error);
    }

    // Derived totals for the stat strip. `unlinkedTagCount` is best-effort
    // (we need StEvE to know the full tag roster); if StEvE fails we fall
    // back to 0 to avoid breaking the page.
    let unlinkedTagCount = 0;
    try {
      const allTags = await steveClient.getOcppTags();
      const mappedIds = new Set(
        mappings.map((m) => m.steveOcppIdTag.toLowerCase()),
      );
      unlinkedTagCount = allTags.filter(
        (t) => !mappedIds.has(t.idTag.toLowerCase()),
      ).length;
    } catch (error) {
      console.error("Failed to fetch StEvE tags for unlinked count:", error);
    }

    const customersLinked = new Set(
      mappings
        .filter((m) => m.lagoCustomerExternalId)
        .map((m) => m.lagoCustomerExternalId as string),
    ).size;
    const metaTagsLinked = mappings.filter((m) =>
      isMetaTag(m.steveOcppIdTag)
    ).length;

    return {
      data: {
        mappings,
        subscriptionNames: Object.fromEntries(subscriptionNames),
        customerLagoIds: Object.fromEntries(customerLagoIds),
        subscriptionLagoIds: Object.fromEntries(subscriptionLagoIds),
        totals: {
          customersLinked,
          tagsLinked: mappings.length,
          metaTagsLinked,
          unlinkedTagCount,
        },
      },
    };
  },
});

function LinkTagsAction() {
  return (
    <a
      href="/links/new"
      className="flex items-center justify-center gap-2 px-4 transition-colors"
      style={{ height: CHROME_SIZE }}
    >
      <Plus className="size-5" />
      <span className="text-sm font-medium">Link Tags</span>
    </a>
  );
}

export default define.page<typeof handler>(
  function TagLinkingPage({ data, url, state }) {
    const groupedMappings = groupMappingsByCustomer(
      data.mappings,
      data.subscriptionNames,
      data.customerLagoIds,
      data.subscriptionLagoIds,
    );

    return (
      <SidebarLayout
        currentPath={url.pathname}
        user={state.user}
        accentColor="violet"
        actions={<LinkTagsAction />}
      >
        <PageCard
          title="Tag Linking"
          description={groupedMappings.length === 0
            ? "Connect OCPP tags to Lago customers to start billing."
            : `${groupedMappings.length} customer${
              groupedMappings.length !== 1 ? "s" : ""
            } linked`}
          colorScheme="violet"
        >
          <div class="mb-6">
            <LinkingStatStrip totals={data.totals} />
          </div>

          {groupedMappings.length === 0
            ? <LinkingEmptyState />
            : (
              <TagLinkingGrid
                groups={groupedMappings}
                lagoDashboardUrl={config.LAGO_DASHBOARD_URL}
                steveDashboardUrl={config.STEVE_BASE_URL}
              />
            )}
        </PageCard>
      </SidebarLayout>
    );
  },
);

interface MappingGroup {
  customerId: string;
  customerName: string;
  customerLagoId?: string;
  subscriptionId: string;
  subscriptionName?: string;
  subscriptionLagoId?: string;
  isActive: boolean;
  tags: Array<{
    id: string;
    ocppTagPk: number;
    mappingId: number;
    isChild: boolean;
    tagType: string;
  }>;
}

function groupMappingsByCustomer(
  mappings: schema.UserMapping[],
  subscriptionNames: Record<string, string>,
  customerLagoIds: Record<string, string>,
  subscriptionLagoIds: Record<string, string>,
): MappingGroup[] {
  const groups = new Map<string, MappingGroup>();

  for (const mapping of mappings) {
    const key =
      `${mapping.lagoCustomerExternalId}:${mapping.lagoSubscriptionExternalId}`;
    const isChild = mapping.notes?.includes("Auto-created from parent") ??
      false;

    if (!groups.has(key)) {
      const externalCustomerId = mapping.lagoCustomerExternalId || "";
      const externalSubscriptionId = mapping.lagoSubscriptionExternalId || "";

      groups.set(key, {
        customerId: externalCustomerId,
        customerName: mapping.displayName || externalCustomerId || "Unknown",
        customerLagoId: customerLagoIds[externalCustomerId],
        subscriptionId: externalSubscriptionId,
        subscriptionName: subscriptionNames[externalSubscriptionId],
        subscriptionLagoId: subscriptionLagoIds[externalSubscriptionId],
        isActive: mapping.isActive ?? true,
        tags: [],
      });
    }

    const group = groups.get(key)!;
    group.tags.push({
      id: mapping.steveOcppIdTag,
      ocppTagPk: mapping.steveOcppTagPk,
      mappingId: mapping.id,
      isChild,
      tagType: mapping.tagType,
    });

    if (!isChild && mapping.displayName) {
      group.customerName = mapping.displayName;
    }
  }

  for (const group of groups.values()) {
    group.tags.sort((a, b) => {
      if (a.isChild !== b.isChild) return a.isChild ? 1 : -1;
      return a.id.localeCompare(b.id);
    });
  }

  return Array.from(groups.values()).sort((a, b) =>
    a.customerName.localeCompare(b.customerName)
  );
}

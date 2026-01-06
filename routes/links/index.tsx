import { define } from "../../utils.ts";
import { db } from "../../src/db/index.ts";
import * as schema from "../../src/db/schema.ts";
import { SidebarLayout } from "../../components/SidebarLayout.tsx";
import { Plus } from "lucide-preact";
import TagLinkingGrid from "../../islands/TagLinkingGrid.tsx";
import { config } from "../../src/lib/config.ts";
import { lagoClient } from "../../src/lib/lago-client.ts";
import { PageCard } from "../../components/PageCard.tsx";
import { CHROME_SIZE } from "../../components/AppSidebar.tsx";

export const handler = define.handlers({
  async GET(_ctx) {
    const mappings = await db.select().from(schema.userMappings);

    // Fetch subscription names and Lago IDs from Lago
    const subscriptionNames = new Map<string, string>();
    // Maps external_id -> lago_id for URL generation
    const customerLagoIds = new Map<string, string>();
    const subscriptionLagoIds = new Map<string, string>();

    try {
      // Fetch customers to get lago_id mappings
      const { customers } = await lagoClient.getCustomers();
      for (const customer of customers) {
        customerLagoIds.set(customer.external_id, customer.lago_id);
      }

      // Fetch subscriptions to get lago_id mappings and names
      const { subscriptions } = await lagoClient.getSubscriptions();
      for (const sub of subscriptions) {
        subscriptionNames.set(sub.external_id, sub.name || sub.plan_code);
        subscriptionLagoIds.set(sub.external_id, sub.lago_id);
      }
    } catch (error) {
      console.error("Failed to fetch Lago data:", error);
      // Continue without Lago data
    }

    return {
      data: {
        mappings,
        subscriptionNames: Object.fromEntries(subscriptionNames),
        customerLagoIds: Object.fromEntries(customerLagoIds),
        subscriptionLagoIds: Object.fromEntries(subscriptionLagoIds),
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
    // Group mappings by customer/subscription
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
          description={`${groupedMappings.length} customer${
            groupedMappings.length !== 1 ? "s" : ""
          } linked`}
          colorScheme="violet"
        >
          <TagLinkingGrid
            groups={groupedMappings}
            lagoDashboardUrl={config.LAGO_DASHBOARD_URL}
            steveDashboardUrl={config.STEVE_BASE_URL}
          />
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
    });

    // Use the first non-child mapping's display name as customer name
    if (!isChild && mapping.displayName) {
      group.customerName = mapping.displayName;
    }
  }

  // Sort tags within each group (parents first, then children)
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

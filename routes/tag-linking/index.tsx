import { define } from "../../utils.ts";
import { db } from "../../src/db/index.ts";
import * as schema from "../../src/db/schema.ts";
import { SidebarLayout } from "../../components/SidebarLayout.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Plus } from "lucide-preact";
import TagLinkingGrid from "../../islands/TagLinkingGrid.tsx";
import { config } from "../../src/lib/config.ts";
import { lagoClient } from "../../src/lib/lago-client.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const mappings = await db.select().from(schema.userMappings);

    // Fetch subscription names from Lago
    const subscriptionNames = new Map<string, string>();
    try {
      const { subscriptions } = await lagoClient.getSubscriptions();
      for (const sub of subscriptions) {
        // Use name if available, otherwise fall back to plan_code
        subscriptionNames.set(sub.external_id, sub.name || sub.plan_code);
      }
    } catch (error) {
      console.error("Failed to fetch Lago subscriptions:", error);
      // Continue without subscription names
    }

    return { data: { mappings, subscriptionNames: Object.fromEntries(subscriptionNames) } };
  },
});

export default define.page<typeof handler>(
  function TagLinkingPage({ data, url, state }) {
    // Group mappings by customer/subscription
    const groupedMappings = groupMappingsByCustomer(data.mappings, data.subscriptionNames);

    return (
      <SidebarLayout
        currentPath={url.pathname}
        title="Tag Linking"
        description="Link OCPP tags to Lago billing customers and subscriptions"
        user={state.user}
        actions={
          <Button asChild>
            <a href="/tag-linking/new">
              <Plus className="size-4 mr-2" />
              Link Tags
            </a>
          </Button>
        }
      >
        <TagLinkingGrid
          groups={groupedMappings}
          lagoDashboardUrl={config.LAGO_DASHBOARD_URL}
          steveDashboardUrl={config.STEVE_BASE_URL}
        />
      </SidebarLayout>
    );
  },
);

interface MappingGroup {
  customerId: string;
  customerName: string;
  subscriptionId: string;
  subscriptionName?: string;
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
): MappingGroup[] {
  const groups = new Map<string, MappingGroup>();

  for (const mapping of mappings) {
    const key = `${mapping.lagoCustomerExternalId}:${mapping.lagoSubscriptionExternalId}`;
    const isChild = mapping.notes?.includes("Auto-created from parent") ?? false;

    if (!groups.has(key)) {
      groups.set(key, {
        customerId: mapping.lagoCustomerExternalId || "",
        customerName: mapping.displayName || mapping.lagoCustomerExternalId || "Unknown",
        subscriptionId: mapping.lagoSubscriptionExternalId || "",
        subscriptionName: subscriptionNames[mapping.lagoSubscriptionExternalId || ""],
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


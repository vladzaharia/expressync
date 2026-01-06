/**
 * Tag Sync Service
 *
 * Synchronizes OCPP tag settings based on mapping status:
 * - Tags with mappings (direct or inherited): maxActiveTransactionCount = -1 (unlimited)
 * - Tags without mappings: maxActiveTransactionCount = 0 (blocked)
 *
 * Always updates the note field on every sync to track sync status.
 */

import { steveClient } from "../lib/steve-client.ts";
import { lagoClient } from "../lib/lago-client.ts";
import { logger } from "../lib/utils/logger.ts";
import { config } from "../lib/config.ts";
import type { StEvEOcppTag } from "../lib/types/steve.ts";
import type { UserMapping } from "../db/schema.ts";
import { buildMappingLookupWithInheritance } from "./mapping-resolver.ts";

export interface TagSyncResult {
  totalTags: number;
  activatedTags: number;
  deactivatedTags: number;
  unchangedTags: number;
  errors: Array<{ tagId: string; error: string }>;
}

/**
 * Info about a customer/subscription for note generation
 */
interface EntityInfo {
  customerName: string;
  subscriptionName: string;
  customerUrl: string | null;
  subscriptionUrl: string | null;
}

/**
 * Fetch customer and subscription names for all mappings
 */
async function fetchEntityInfo(
  mappings: UserMapping[],
): Promise<Map<string, EntityInfo>> {
  const infoMap = new Map<string, EntityInfo>();
  const lagoDashboard = config.LAGO_DASHBOARD_URL;

  // Get unique customer IDs
  const customerIds = [
    ...new Set(mappings.map((m) => m.lagoCustomerExternalId).filter(Boolean)),
  ] as string[];

  // Fetch all customers and subscriptions
  // Maps: external_id -> display name
  const customerNames = new Map<string, string>();
  const subscriptionNames = new Map<string, string>();
  // Maps: external_id -> lago_id (internal ID for URLs)
  const customerLagoIds = new Map<string, string>();
  const subscriptionLagoIds = new Map<string, string>();

  try {
    // Fetch customers
    const { customers } = await lagoClient.getCustomers();
    for (const customer of customers) {
      const displayName = customer.name || customer.external_id;
      customerNames.set(customer.external_id, displayName);
      customerLagoIds.set(customer.external_id, customer.lago_id);
    }

    // Fetch subscriptions for each customer
    for (const customerId of customerIds) {
      try {
        const { subscriptions } = await lagoClient.getSubscriptions(customerId);
        for (const sub of subscriptions) {
          const displayName = sub.name || sub.external_id;
          subscriptionNames.set(sub.external_id, displayName);
          subscriptionLagoIds.set(sub.external_id, sub.lago_id);
        }
      } catch {
        logger.warn("TagSync", `Failed to fetch subscriptions for customer`, {
          customerId,
        });
      }
    }
  } catch (error) {
    logger.warn("TagSync", "Failed to fetch Lago entities for note generation", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Build info map for each mapping
  for (const mapping of mappings) {
    if (!mapping.lagoCustomerExternalId || !mapping.lagoSubscriptionExternalId) {
      continue;
    }

    const key = `${mapping.lagoCustomerExternalId}:${mapping.lagoSubscriptionExternalId}`;
    const customerName = customerNames.get(mapping.lagoCustomerExternalId) ||
      mapping.lagoCustomerExternalId;
    const subscriptionName =
      subscriptionNames.get(mapping.lagoSubscriptionExternalId) ||
      mapping.lagoSubscriptionExternalId;

    // Get Lago internal IDs for URL generation
    const customerLagoId = customerLagoIds.get(mapping.lagoCustomerExternalId);
    const subscriptionLagoId = subscriptionLagoIds.get(mapping.lagoSubscriptionExternalId);

    // Lago URL format uses internal lago_id: /customer/{lagoId} and /customer/{lagoId}/subscription/{lagoSubId}/overview
    infoMap.set(key, {
      customerName,
      subscriptionName,
      customerUrl: lagoDashboard && customerLagoId
        ? `${lagoDashboard}/customer/${customerLagoId}`
        : null,
      subscriptionUrl: lagoDashboard && customerLagoId && subscriptionLagoId
        ? `${lagoDashboard}/customer/${customerLagoId}/subscription/${subscriptionLagoId}/overview`
        : null,
    });
  }

  return infoMap;
}

/**
 * Generate note for a tag WITH an active mapping
 *
 * Format:
 * Linked to {Customer Name} > {Subscription Name}
 * Customer: {Customer URL}
 * Subscription: {Subscription URL}
 * ---
 * Last synced on {timestamp}
 */
function generateLinkedNote(
  mapping: UserMapping,
  entityInfo: EntityInfo | undefined,
  timestamp: string,
): string {
  const customerName = entityInfo?.customerName ||
    mapping.lagoCustomerExternalId || "Unknown";
  const subscriptionName = entityInfo?.subscriptionName ||
    mapping.lagoSubscriptionExternalId || "Unknown";

  const lines: string[] = [
    `Linked to ${customerName} > ${subscriptionName}`,
  ];

  // Only include URLs if we have them (requires Lago internal IDs)
  if (entityInfo?.customerUrl) {
    lines.push(`Customer: ${entityInfo.customerUrl}`);
  }
  if (entityInfo?.subscriptionUrl) {
    lines.push(`Subscription: ${entityInfo.subscriptionUrl}`);
  }

  lines.push("---");
  lines.push(`Last synced on ${timestamp}`);

  return lines.join("\n");
}

/**
 * Generate note for a tag WITHOUT an active mapping
 */
function generateUnlinkedNote(timestamp: string): string {
  return `No active subscription\n---\nLast synced on ${timestamp}`;
}

/**
 * Sync all OCPP tags based on their mapping status
 */
export async function syncTagStatus(
  mappings: UserMapping[],
  allTags: StEvEOcppTag[],
): Promise<TagSyncResult> {
  logger.info("TagSync", "Starting tag status synchronization", {
    totalMappings: mappings.length,
    totalTags: allTags.length,
  });

  const result: TagSyncResult = {
    totalTags: allTags.length,
    activatedTags: 0,
    deactivatedTags: 0,
    unchangedTags: 0,
    errors: [],
  };

  // Build mapping lookup with inheritance
  const mappingLookup = buildMappingLookupWithInheritance(mappings, allTags);

  logger.debug("TagSync", "Built mapping lookup", {
    mappedTagsCount: mappingLookup.size,
  });

  // Fetch customer/subscription names for notes
  const entityInfoMap = await fetchEntityInfo(mappings);

  // Generate sync timestamp once for all tags
  const syncTimestamp = new Date().toISOString();

  // Process each tag - ALWAYS update note to track sync status
  for (const tag of allTags) {
    try {
      const mapping = mappingLookup.get(tag.idTag);
      const hasMapping = !!mapping;
      const desiredLimit = hasMapping ? -1 : 0; // -1 = unlimited, 0 = blocked
      const currentLimit = tag.maxActiveTransactionCount ?? -1;
      const statusChanged = currentLimit !== desiredLimit;

      // Get entity info for this mapping (if exists)
      const entityKey = mapping
        ? `${mapping.lagoCustomerExternalId}:${mapping.lagoSubscriptionExternalId}`
        : null;
      const entityInfo = entityKey ? entityInfoMap.get(entityKey) : undefined;

      // Generate note based on mapping status - ALWAYS update this
      const desiredNote = hasMapping && mapping
        ? generateLinkedNote(mapping, entityInfo, syncTimestamp)
        : generateUnlinkedNote(syncTimestamp);

      // Always update the tag to keep the sync timestamp current
      logger.info("TagSync", "Updating tag", {
        tagId: tag.idTag,
        statusChanged,
        from: currentLimit,
        to: desiredLimit,
        hasMapping,
      });

      // Create updated tag object with new limit and note
      const updatedTag: StEvEOcppTag = {
        ...tag,
        maxActiveTransactionCount: desiredLimit,
        note: desiredNote,
      };

      await steveClient.updateOcppTag(updatedTag);

      if (statusChanged) {
        if (desiredLimit === -1) {
          result.activatedTags++;
        } else {
          result.deactivatedTags++;
        }
      } else {
        result.unchangedTags++;
      }
    } catch (error) {
      logger.error("TagSync", "Failed to update tag", {
        tagId: tag.idTag,
        error: error instanceof Error ? error.message : String(error),
      });
      result.errors.push({
        tagId: tag.idTag,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info("TagSync", "Tag status synchronization complete", {
    ...result,
  });

  return result;
}



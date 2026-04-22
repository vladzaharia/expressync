import type { UserMapping } from "../db/schema.ts";
import type { StEvEOcppTag } from "../lib/types/steve.ts";
import type { LagoSubscription } from "../lib/types/lago.ts";
import { getAllAncestorTags } from "../lib/tag-hierarchy.ts";
import { logger } from "../lib/utils/logger.ts";
import { lagoClient } from "../lib/lago-client.ts";

/**
 * Resolve a mapping for an OCPP tag, checking parent tags if no direct mapping exists
 *
 * This enables inheritance: if a child tag doesn't have a mapping, it will use
 * the mapping from its parent tag (or grandparent, etc.)
 *
 * @param ocppIdTag - The OCPP tag to find a mapping for
 * @param mappingsByTag - Map of direct mappings by OCPP tag ID
 * @param allTags - All available OCPP tags (for hierarchy lookup)
 * @returns The resolved mapping, or undefined if none found
 */
export function resolveMappingWithInheritance(
  ocppIdTag: string,
  mappingsByTag: Map<string, UserMapping>,
  allTags: StEvEOcppTag[],
): UserMapping | undefined {
  // First, check for a direct mapping
  const directMapping = mappingsByTag.get(ocppIdTag);
  if (directMapping) {
    logger.debug("MappingResolver", "Found direct mapping", {
      ocppIdTag,
      mappingId: directMapping.id,
    });
    return directMapping;
  }

  // No direct mapping, check parent tags
  const tag = allTags.find((t) => t.idTag === ocppIdTag);
  if (!tag) {
    logger.warn("MappingResolver", "Tag not found in tag list", { ocppIdTag });
    return undefined;
  }

  if (!tag.parentIdTag) {
    logger.debug("MappingResolver", "No parent tag, no mapping found", {
      ocppIdTag,
    });
    return undefined;
  }

  // Get all ancestor tags (parent, grandparent, etc.)
  const ancestors = getAllAncestorTags(tag, allTags);

  logger.debug("MappingResolver", "Checking ancestor tags for mapping", {
    ocppIdTag,
    ancestorCount: ancestors.length,
    ancestors: ancestors.map((a) => a.idTag),
  });

  // Check each ancestor for a mapping (closest ancestor first)
  for (const ancestor of ancestors) {
    const ancestorMapping = mappingsByTag.get(ancestor.idTag);
    if (ancestorMapping) {
      logger.info("MappingResolver", "Found inherited mapping from ancestor", {
        ocppIdTag,
        ancestorTag: ancestor.idTag,
        mappingId: ancestorMapping.id,
      });
      return ancestorMapping;
    }
  }

  logger.debug("MappingResolver", "No mapping found (direct or inherited)", {
    ocppIdTag,
    checkedAncestors: ancestors.length,
  });

  return undefined;
}

/**
 * Build an enhanced mapping lookup that includes inherited mappings
 *
 * This creates a Map where child tags without direct mappings will
 * automatically resolve to their parent's mapping
 *
 * @param directMappings - Array of user mappings from database
 * @param allTags - All available OCPP tags
 * @returns Map of OCPP tag ID to mapping (including inherited)
 */
export function buildMappingLookupWithInheritance(
  directMappings: UserMapping[],
  allTags: StEvEOcppTag[],
): Map<string, UserMapping> {
  // First, create a map of direct mappings
  const directMappingsByTag = new Map(
    directMappings
      .filter((m) => m.lagoSubscriptionExternalId || m.lagoCustomerExternalId) // Mappings with subscriptions or customer IDs
      .map((m) => [m.steveOcppIdTag, m]),
  );

  logger.debug("MappingResolver", "Building mapping lookup with inheritance", {
    directMappingsCount: directMappingsByTag.size,
    totalTagsCount: allTags.length,
  });

  // Create an enhanced map that includes inherited mappings
  const enhancedMap = new Map<string, UserMapping>();

  // Add all direct mappings
  for (const [tag, mapping] of directMappingsByTag) {
    enhancedMap.set(tag, mapping);
  }

  // For each tag without a direct mapping, try to resolve from parents
  for (const tag of allTags) {
    if (!enhancedMap.has(tag.idTag)) {
      const resolvedMapping = resolveMappingWithInheritance(
        tag.idTag,
        directMappingsByTag,
        allTags,
      );
      if (resolvedMapping) {
        enhancedMap.set(tag.idTag, resolvedMapping);
      }
    }
  }

  logger.info("MappingResolver", "Mapping lookup built with inheritance", {
    directMappingsCount: directMappingsByTag.size,
    totalMappingsCount: enhancedMap.size,
    inheritedMappingsCount: enhancedMap.size - directMappingsByTag.size,
  });

  return enhancedMap;
}

/**
 * Resolved subscription info: external ID plus the plan code backing it.
 * planCode is `null` when we used an explicit mapping-level external ID and
 * haven't fetched the subscription from Lago (i.e. we trust the mapping).
 */
export interface ResolvedSubscription {
  externalId: string;
  planCode: string | null;
}

/**
 * Shared cache type for subscription resolution. Values can be:
 *   - `null` — no active subscription found (negative cache)
 *   - `{ externalId, planCode }` — resolved via Lago API lookup
 */
export type SubscriptionResolutionCache = Map<
  string,
  ResolvedSubscription | null
>;

/**
 * Resolve subscription for a mapping, auto-selecting if none specified.
 *
 * If the mapping has an explicit `lagoSubscriptionExternalId`, that's
 * returned immediately with `planCode = null` (we don't fetch the plan
 * unless the caller needs it). Otherwise:
 *   1. Fetch all subscriptions for the customer
 *   2. Find the first active subscription
 *   3. Return its external ID + plan code
 *
 * An optional cache avoids redundant Lago API calls when multiple
 * transactions share the same customer.
 */
export async function resolveSubscription(
  mapping: UserMapping,
  cache?: SubscriptionResolutionCache,
): Promise<ResolvedSubscription | null> {
  // If mapping already has a subscription, use it directly.
  if (mapping.lagoSubscriptionExternalId) {
    logger.debug(
      "MappingResolver",
      "Using explicit subscription from mapping",
      {
        mappingId: mapping.id,
        subscriptionId: mapping.lagoSubscriptionExternalId,
      },
    );
    return { externalId: mapping.lagoSubscriptionExternalId, planCode: null };
  }

  // No subscription specified, try to auto-select.
  if (!mapping.lagoCustomerExternalId) {
    logger.warn(
      "MappingResolver",
      "Cannot auto-select subscription: no customer ID",
      { mappingId: mapping.id },
    );
    return null;
  }

  // Check cache first to avoid redundant Lago API calls.
  if (cache && cache.has(mapping.lagoCustomerExternalId)) {
    const cached = cache.get(mapping.lagoCustomerExternalId)!;
    logger.debug(
      "MappingResolver",
      "Using cached subscription for customer",
      {
        mappingId: mapping.id,
        customerId: mapping.lagoCustomerExternalId,
        cachedSubscriptionId: cached?.externalId ?? null,
        cachedPlanCode: cached?.planCode ?? null,
      },
    );
    return cached;
  }

  logger.info("MappingResolver", "Auto-selecting subscription for customer", {
    mappingId: mapping.id,
    customerId: mapping.lagoCustomerExternalId,
  });

  try {
    const { subscriptions } = await lagoClient.getSubscriptions(
      mapping.lagoCustomerExternalId,
    );
    const activeSubscription = subscriptions.find(
      (sub: LagoSubscription) => sub.status === "active",
    );

    if (activeSubscription) {
      const resolved: ResolvedSubscription = {
        externalId: activeSubscription.external_id,
        planCode: activeSubscription.plan_code,
      };
      logger.info("MappingResolver", "Auto-selected active subscription", {
        mappingId: mapping.id,
        subscriptionId: resolved.externalId,
        subscriptionName: activeSubscription.name,
        planCode: resolved.planCode,
      });
      if (cache) cache.set(mapping.lagoCustomerExternalId, resolved);
      return resolved;
    }

    logger.warn(
      "MappingResolver",
      "No active subscription found for customer",
      {
        mappingId: mapping.id,
        customerId: mapping.lagoCustomerExternalId,
        totalSubscriptions: subscriptions.length,
      },
    );
    if (cache) cache.set(mapping.lagoCustomerExternalId, null);
    return null;
  } catch (error) {
    logger.error(
      "MappingResolver",
      "Failed to fetch subscriptions for auto-selection",
      {
        mappingId: mapping.id,
        customerId: mapping.lagoCustomerExternalId,
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return null;
  }
}

/**
 * Backwards-compatible wrapper: returns just the subscription external ID.
 * Prefer `resolveSubscription` for new code that needs the plan code.
 */
export async function resolveSubscriptionId(
  mapping: UserMapping,
  cache?: SubscriptionResolutionCache,
): Promise<string | null> {
  const resolved = await resolveSubscription(mapping, cache);
  return resolved?.externalId ?? null;
}

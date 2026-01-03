import type { UserMapping } from "../db/schema.ts";
import type { StEvEOcppTag } from "../lib/types/steve.ts";
import { getAllAncestorTags } from "../lib/tag-hierarchy.ts";
import { logger } from "../lib/utils/logger.ts";

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
  allTags: StEvEOcppTag[]
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
  allTags: StEvEOcppTag[]
): Map<string, UserMapping> {
  // First, create a map of direct mappings
  const directMappingsByTag = new Map(
    directMappings
      .filter((m) => m.lagoSubscriptionExternalId) // Only mappings with subscriptions
      .map((m) => [m.steveOcppIdTag, m])
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
        allTags
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


/**
 * Tag Sync Service
 *
 * Synchronizes OCPP tag settings based on mapping status:
 * - Tags with mappings (direct or inherited): maxActiveTransactionCount = -1 (unlimited)
 * - Tags without mappings: maxActiveTransactionCount = 0 (blocked)
 */

import { steveClient } from "../lib/steve-client.ts";
import { logger } from "../lib/utils/logger.ts";
import type { StEvEOcppTag } from "../lib/types/steve.ts";
import type { UserMapping } from "../db/schema.ts";
import { buildMappingLookupWithInheritance } from "./mapping-resolver.ts";

export interface TagSyncResult {
  totalTags: number;
  enabledTags: number;
  disabledTags: number;
  unchangedTags: number;
  errors: Array<{ tagId: string; error: string }>;
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
    enabledTags: 0,
    disabledTags: 0,
    unchangedTags: 0,
    errors: [],
  };

  // Build mapping lookup with inheritance
  const mappingLookup = buildMappingLookupWithInheritance(mappings, allTags);

  logger.debug("TagSync", "Built mapping lookup", {
    mappedTagsCount: mappingLookup.size,
  });

  // Process each tag
  for (const tag of allTags) {
    try {
      const hasMapping = mappingLookup.has(tag.idTag);
      const desiredLimit = hasMapping ? -1 : 0; // -1 = unlimited, 0 = blocked
      const currentLimit = tag.maxActiveTransactionCount ?? -1;

      // Skip if already at desired state
      if (currentLimit === desiredLimit) {
        result.unchangedTags++;
        logger.debug("TagSync", "Tag already at desired state", {
          tagId: tag.idTag,
          limit: desiredLimit,
        });
        continue;
      }

      // Update tag - must send complete tag object to StEvE
      logger.info("TagSync", "Updating tag status", {
        tagId: tag.idTag,
        from: currentLimit,
        to: desiredLimit,
        hasMapping,
      });

      // Create updated tag object with new maxActiveTransactionCount
      const updatedTag = {
        ...tag,
        maxActiveTransactionCount: desiredLimit,
      };

      await steveClient.updateOcppTag(updatedTag);

      if (desiredLimit === -1) {
        result.enabledTags++;
      } else {
        result.disabledTags++;
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

  logger.info("TagSync", "Tag status synchronization complete", result);

  return result;
}

/**
 * Sync a single tag's status based on mapping
 */
export async function syncSingleTagStatus(
  tagPk: number,
  tagId: string,
  hasMapping: boolean,
): Promise<void> {
  const desiredLimit = hasMapping ? -1 : 0;

  logger.info("TagSync", "Syncing single tag status", {
    tagId,
    tagPk,
    hasMapping,
    desiredLimit,
  });

  try {
    await steveClient.updateOcppTag(tagPk, {
      maxActiveTransactionCount: desiredLimit,
    });

    logger.info("TagSync", "Successfully synced tag status", {
      tagId,
      limit: desiredLimit,
    });
  } catch (error) {
    logger.error("TagSync", "Failed to sync tag status", {
      tagId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

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
import { logger } from "../lib/utils/logger.ts";
import { config } from "../lib/config.ts";
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
 * Generate note for a tag WITH an active mapping
 */
function generateLinkedNote(mapping: UserMapping, timestamp: string): string {
  const lagoDashboard = config.LAGO_DASHBOARD_URL;

  const customerDisplay = mapping.lagoCustomerExternalId || "Unknown";
  const subscriptionDisplay = mapping.lagoSubscriptionExternalId || "Unknown";

  const lines: string[] = [
    `Linked to ${customerDisplay} > ${subscriptionDisplay}`,
  ];

  // Add customer link
  if (lagoDashboard && mapping.lagoCustomerExternalId) {
    lines.push(`Customer: ${lagoDashboard}/customers/${mapping.lagoCustomerExternalId}`);
  } else if (mapping.lagoCustomerExternalId) {
    lines.push(`Customer: ${mapping.lagoCustomerExternalId}`);
  }

  // Add subscription link
  if (lagoDashboard && mapping.lagoSubscriptionExternalId) {
    lines.push(`Subscription: ${lagoDashboard}/subscriptions/${mapping.lagoSubscriptionExternalId}`);
  } else if (mapping.lagoSubscriptionExternalId) {
    lines.push(`Subscription: ${mapping.lagoSubscriptionExternalId}`);
  }

  lines.push("---");
  lines.push(`Last synced on ${timestamp}`);

  return lines.join("\n");
}

/**
 * Generate note for a tag WITHOUT an active mapping
 */
function generateUnlinkedNote(timestamp: string): string {
  return `No active Lago mapping\n---\nLast synced on ${timestamp}`;
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

      // Generate note based on mapping status - ALWAYS update this
      const desiredNote = hasMapping && mapping
        ? generateLinkedNote(mapping, syncTimestamp)
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
          result.enabledTags++;
        } else {
          result.disabledTags++;
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

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
import { db } from "../db/index.ts";
import {
  notifications,
  tagChangeLog,
  type TagChangeType,
  type UserMapping,
} from "../db/schema.ts";
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
    logger.warn(
      "TagSync",
      "Failed to fetch Lago entities for note generation",
      {
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }

  // Build info map for each mapping
  for (const mapping of mappings) {
    if (
      !mapping.lagoCustomerExternalId || !mapping.lagoSubscriptionExternalId
    ) {
      continue;
    }

    const key =
      `${mapping.lagoCustomerExternalId}:${mapping.lagoSubscriptionExternalId}`;
    const customerName = customerNames.get(mapping.lagoCustomerExternalId) ||
      mapping.lagoCustomerExternalId;
    const subscriptionName =
      subscriptionNames.get(mapping.lagoSubscriptionExternalId) ||
      mapping.lagoSubscriptionExternalId;

    // Get Lago internal IDs for URL generation
    const customerLagoId = customerLagoIds.get(mapping.lagoCustomerExternalId);
    const subscriptionLagoId = subscriptionLagoIds.get(
      mapping.lagoSubscriptionExternalId,
    );

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
 * Classify the kind of change observed on a tag.
 *
 * Rules (order matters):
 *   - activated:   limit was 0 -> desired is -1
 *   - deactivated: limit was -1 (or >0) -> desired is 0
 *   - updated:     status unchanged, but note changed
 */
function classifyTagChange(
  currentLimit: number,
  desiredLimit: number,
  noteChanged: boolean,
): TagChangeType | null {
  if (currentLimit !== desiredLimit) {
    if (desiredLimit === -1 && currentLimit === 0) return "activated";
    if (desiredLimit === 0 && currentLimit !== 0) return "deactivated";
    // Any other numeric transition gets logged as "updated" for now.
    return "updated";
  }
  if (noteChanged) return "updated";
  return null;
}

/**
 * Sync all OCPP tags based on their mapping status
 *
 * @param syncRunId Optional syncRun id; when provided, tag_change_log rows
 *                  written during this run will reference it.
 */
export async function syncTagStatus(
  mappings: UserMapping[],
  allTags: StEvEOcppTag[],
  syncRunId?: number,
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

      // Generate note based on mapping status
      const desiredNote = hasMapping && mapping
        ? generateLinkedNote(mapping, entityInfo, syncTimestamp)
        : generateUnlinkedNote(syncTimestamp);

      // Compare current state vs desired state - only update if something changed
      // Strip timestamp line from comparison so that "Last synced on ..." alone
      // doesn't force an update every cycle.
      const stripTimestamp = (note: string) =>
        note.replace(/Last synced on .+$/, "").trim();
      const noteChanged =
        stripTimestamp(tag.note ?? "") !== stripTimestamp(desiredNote);

      if (!statusChanged && !noteChanged) {
        // Nothing changed, skip the API call
        logger.debug("TagSync", "Tag unchanged, skipping update", {
          tagId: tag.idTag,
          hasMapping,
        });
        result.unchangedTags++;
        continue;
      }

      logger.info("TagSync", "Updating tag", {
        tagId: tag.idTag,
        statusChanged,
        noteChanged,
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

      // Phase C: record the change in tag_change_log BEFORE the StEvE write
      // so activity is captured even if upstream fails. This feeds the
      // adaptive scheduler's "any tag change in 30d" signal.
      const changeType = classifyTagChange(
        currentLimit,
        desiredLimit,
        noteChanged,
      );
      if (changeType) {
        try {
          await db.insert(tagChangeLog).values({
            ocppTagPk: tag.ocppTagPk,
            idTag: tag.idTag,
            changeType,
            before: {
              maxActiveTransactionCount: currentLimit,
              note: tag.note ?? null,
            },
            after: {
              maxActiveTransactionCount: desiredLimit,
              note: desiredNote,
            },
            syncRunId: syncRunId ?? null,
          });
        } catch (logErr) {
          // Never let audit-log failures block the StEvE update.
          logger.warn("TagSync", "Failed to persist tag_change_log row", {
            tagId: tag.idTag,
            error: logErr instanceof Error ? logErr.message : String(logErr),
          });
        }
      }

      await steveClient.updateOcppTag(updatedTag);

      if (statusChanged) {
        if (desiredLimit === -1) {
          result.activatedTags++;
        } else {
          result.deactivatedTags++;
        }
      } else {
        // Note changed but status didn't
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

// ============================================================================
// Single-tag inline sync (Polaris Track A — Lifecycle / "Immediate StEvE
// propagation"). Used by the admin-tag-link route + Lago webhook handlers so
// activation/deactivation of a card hits StEvE on the spot rather than
// waiting up to 15 min for the next background pass.
// ============================================================================

export interface SyncSingleTagResult {
  ok: boolean;
  error?: string;
}

/**
 * Push a single mapping's active/inactive status to StEvE inline.
 *
 * Called from every admin/web hook code-path that creates, updates, or
 * deactivates a `user_mappings` row. The next background sync pass already
 * reconciles drift on its own schedule (15 min default), so a transient
 * StEvE outage here only widens the worst-case window — it does not corrupt
 * state. The DB write that triggered this call has already committed.
 *
 * Failure semantics (per the plan):
 *   - DB change persists (the caller's transaction has already committed).
 *   - StEvE call is attempted ONCE inline.
 *   - On failure: insert a `notifications` row with `kind='steve_sync_failed'`,
 *     `severity='error'`, `audience='admin'`, sourceType='mapping' so the
 *     admin can see the drift and reconcile.
 *   - Returns `{ ok: false, error: <message> }`. NEVER throws — caller must
 *     not roll back DB state on this signal.
 *
 * Note: this writes a stale-time-stamped note even on the inline path so the
 * admin opening the StEvE-side tag editor sees the right context. The
 * background `syncTagStatus` will overwrite this note on its next pass with
 * fresh customer/subscription metadata.
 */
export async function syncSingleTagToSteve(
  mapping: UserMapping,
): Promise<SyncSingleTagResult> {
  const timestamp = new Date().toISOString();
  const note = mapping.isActive
    // Active: succinct note; the background pass will enrich this with the
    // full customer/subscription label on its next cycle.
    ? `Active mapping ${mapping.id}\n---\nLast updated by Polaris ${timestamp}`
    // Inactive: explicit deactivation note carries the timestamp + mapping
    // id so an operator opening StEvE can correlate it back to our DB.
    : `Deactivated by Polaris ${timestamp} (mapping ${mapping.id})\n---\nLast updated by Polaris ${timestamp}`;

  // Construct the payload StEvE expects. `maxActiveTransactionCount`:
  //   -1 → unlimited (active)
  //    0 → blocked (deactivated)
  //
  // SteVe's update endpoint is a full PUT — every field on the row gets
  // replaced. So we MUST pass through `parentIdTag` and `expiryDate`
  // from our local mirror columns; otherwise every inline sync clobbers
  // them to NULL. (See migration 0031 for the column rationale.)
  const updatedTag: StEvEOcppTag = {
    idTag: mapping.steveOcppIdTag,
    ocppTagPk: mapping.steveOcppTagPk,
    note,
    parentIdTag: mapping.steveParentIdTag ?? null,
    expiryDate: mapping.steveExpiryDate
      ? new Date(mapping.steveExpiryDate).toISOString()
      : null,
    maxActiveTransactionCount: mapping.isActive ? -1 : 0,
  };

  try {
    await steveClient.updateOcppTag(updatedTag);
    logger.info("TagSync", "Inline StEvE sync succeeded", {
      mappingId: mapping.id,
      ocppIdTag: mapping.steveOcppIdTag,
      isActive: mapping.isActive,
    });
    return { ok: true };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error("TagSync", "Inline StEvE sync failed", {
      mappingId: mapping.id,
      ocppIdTag: mapping.steveOcppIdTag,
      isActive: mapping.isActive,
      error: errMsg,
    });

    // Best-effort admin notification. Don't let notification persistence
    // problems mask the real failure — log and swallow.
    try {
      await db.insert(notifications).values({
        kind: "steve_sync_failed",
        severity: "error",
        title: `StEvE sync failed for tag ${mapping.steveOcppIdTag}`,
        body: `${errMsg}. The mapping is set to ${
          mapping.isActive ? "active" : "inactive"
        } in our DB but StEvE was not updated. Background sync will retry.`,
        sourceType: "mapping",
        sourceId: String(mapping.id),
        audience: "admin",
        context: {
          mappingId: mapping.id,
          ocppIdTag: mapping.steveOcppIdTag,
          ocppTagPk: mapping.steveOcppTagPk,
          isActive: mapping.isActive,
          desiredMaxActiveTransactionCount: mapping.isActive ? -1 : 0,
          attemptedAt: timestamp,
          error: errMsg,
        },
      });
    } catch (notificationErr) {
      logger.warn(
        "TagSync",
        "Failed to insert steve_sync_failed notification",
        {
          mappingId: mapping.id,
          error: notificationErr instanceof Error
            ? notificationErr.message
            : String(notificationErr),
        },
      );
    }

    return { ok: false, error: errMsg };
  }
}

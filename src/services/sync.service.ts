import { steveClient } from "../lib/steve-client.ts";
import { lagoClient } from "../lib/lago-client.ts";
import type { TransactionWithCompletion } from "./transaction-processor.ts";
import { processTransactions } from "./transaction-processor.ts";
import {
  BATCH_SIZE,
  batchEvents,
  buildLagoEvents,
} from "./lago-event-builder.ts";
import {
  atomicUpsertSyncStatesAndCreateEvents,
  batchUpsertSyncStates,
  createSyncRun,
  getActiveMappings,
  getRunningSync,
  getSyncStates,
  markSyncComplete,
  markSyncFailed,
  type TagSyncStats,
} from "./sync-db.ts";
import type {
  NewSyncedTransactionEvent,
  NewTransactionSyncState,
  UserMapping,
} from "../db/schema.ts";
import type { StEvEOcppTag } from "../lib/types/steve.ts";
import { logger } from "../lib/utils/logger.ts";
import { buildMappingLookupWithInheritance } from "./mapping-resolver.ts";
import { syncTagStatus } from "./tag-sync.service.ts";
import { SyncLogger } from "./sync-logger.ts";
import { config } from "../lib/config.ts";
import { refreshChargerCache } from "./charger-cache.service.ts";

/**
 * Best-effort charger cache refresh.
 *
 * Called after `markSyncComplete` so a cache failure never fails the sync.
 * Extracted into a helper because `runSync` has three "complete" exit paths.
 */
async function safeRefreshChargerCache(syncRunId: number): Promise<void> {
  try {
    await refreshChargerCache();
  } catch (error) {
    logger.warn("Sync", "Charger cache refresh failed (non-fatal)", {
      syncRunId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export interface SyncResult {
  syncRunId: number;
  transactionsProcessed: number;
  eventsCreated: number;
  errors: string[];
}

/**
 * Run tag status synchronization within a sync logger segment.
 * Extracted helper to avoid duplicating the tag sync block.
 */
async function runTagSync(
  syncLogger: SyncLogger,
  mappings: UserMapping[],
  allTags: StEvEOcppTag[],
  syncRunId: number,
): Promise<TagSyncStats> {
  syncLogger.startSegment("tag_linking");
  let tagStats: TagSyncStats = {
    activatedTags: 0,
    deactivatedTags: 0,
    unchangedTags: 0,
  };
  try {
    syncLogger.info("Starting tag status synchronization");
    const tagSyncResult = await syncTagStatus(mappings, allTags, syncRunId);
    tagStats = {
      activatedTags: tagSyncResult.activatedTags,
      deactivatedTags: tagSyncResult.deactivatedTags,
      unchangedTags: tagSyncResult.unchangedTags,
    };
    syncLogger.info("Tag status synchronization completed", {
      totalTags: tagSyncResult.totalTags,
      ...tagStats,
      errorCount: tagSyncResult.errors.length,
    });
    await syncLogger.endSegment();
  } catch (error) {
    syncLogger.error("Tag sync failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    await syncLogger.endSegment("error");
  }
  return tagStats;
}

/**
 * Run sync cycle (post-transaction billing)
 *
 * This is the main entry point for the sync service.
 * It orchestrates the entire sync process:
 * 1. Fetch completed transactions from StEvE
 * 2. Calculate total kWh per session (stopValue - startValue)
 * 3. Send one Lago event per completed transaction
 * 4. Mark transactions as finalized
 *
 * Active (in-progress) transactions are skipped entirely --
 * billing occurs once per completed charging session.
 */
export async function runSync(): Promise<SyncResult> {
  const errors: string[] = [];
  let transactionsProcessed = 0;
  let eventsCreated = 0;

  logger.info("Sync", "Starting sync process");

  // 0. Check for concurrent sync (prevent race conditions)
  const runningSync = await getRunningSync();
  if (runningSync) {
    logger.warn("Sync", "Another sync is already running, skipping", {
      runningSyncId: runningSync.id,
    });
    return {
      syncRunId: 0,
      transactionsProcessed: 0,
      eventsCreated: 0,
      errors: ["Sync already in progress"],
    };
  }

  // 1. Create sync run record
  const syncRun = await createSyncRun();
  const syncLogger = new SyncLogger(syncRun.id);
  logger.info("Sync", "Sync run created", { syncRunId: syncRun.id });

  try {
    // 2. Fetch recently completed transactions (post-transaction billing model)
    // Active transactions are intentionally skipped -- billing occurs once per
    // completed session with total kWh (stopValue - startValue).
    logger.info("Sync", "Fetching recently completed transactions");
    const recentlyCompleted = await steveClient
      .getRecentlyCompletedTransactions(config.SYNC_LOOKBACK_MINUTES);
    logger.debug("Sync", "Recently completed transactions fetched", {
      count: recentlyCompleted.length,
    });

    // 3. Build transaction map (all completed)
    const allTransactions = new Map<number, TransactionWithCompletion>();
    for (const tx of recentlyCompleted) {
      allTransactions.set(tx.id, { ...tx, isCompleted: true });
    }

    logger.info("Sync", "Completed transactions to process", {
      count: allTransactions.size,
    });

    // Load user mappings and tags early (needed for tag sync even if no transactions)
    logger.debug("Sync", "Loading user mappings");
    const mappings = await getActiveMappings();

    // Fetch all OCPP tags to enable parent/child resolution
    logger.debug("Sync", "Fetching OCPP tags for hierarchy resolution");
    const allTags = await steveClient.getOcppTags();

    if (allTransactions.size === 0) {
      logger.info("Sync", "No transactions to process, completing sync");

      // Sync tag status even when there are no transactions
      const tagStats = await runTagSync(
        syncLogger,
        mappings,
        allTags,
        syncRun.id,
      );

      // Skip transaction sync segment
      await syncLogger.skipSegment(
        "transaction_sync",
        "No transactions to process",
      );

      await markSyncComplete(syncRun.id, 0, 0, undefined, tagStats);
      await safeRefreshChargerCache(syncRun.id);
      return {
        syncRunId: syncRun.id,
        transactionsProcessed: 0,
        eventsCreated: 0,
        errors: [],
      };
    }

    // 4. Load existing sync states for these transactions
    const txIds = Array.from(allTransactions.keys());
    logger.debug("Sync", "Loading sync states", { transactionIds: txIds });
    const existingSyncStates = await getSyncStates(txIds);
    logger.debug("Sync", "Sync states loaded", {
      count: existingSyncStates.length,
    });

    // Create lookup map
    const syncStateByTxId = new Map(
      existingSyncStates.map((s) => [s.steveTransactionId, s]),
    );

    // 5. Build mapping lookup with inheritance (child tags inherit parent mappings)
    const mappingByOcppTag = buildMappingLookupWithInheritance(
      mappings,
      allTags,
    );

    logger.info("Sync", "User mappings loaded with inheritance", {
      directMappings: mappings.filter((m) =>
        m.lagoSubscriptionExternalId
      ).length,
      totalMappingsWithInheritance: mappingByOcppTag.size,
      inheritedMappings: mappingByOcppTag.size -
        mappings.filter((m) => m.lagoSubscriptionExternalId).length,
    });

    // 6. Process each transaction
    logger.info("Sync", "Processing transactions", {
      totalTransactions: allTransactions.size,
    });
    const processedTransactions = await processTransactions(
      allTransactions,
      syncStateByTxId,
      mappingByOcppTag,
    );

    transactionsProcessed = allTransactions.size;

    // Separate transactions that should be sent to Lago from those that shouldn't.
    // Two reasons a transaction is skipped: `no_subscription` (WARN — a mapping is
    // incomplete) and `non_usage_plan` (INFO — intentional, e.g. ExpressChargeM
    // members whose kWh isn't billed per-unit).
    const transactionsToSend = processedTransactions.filter((pt) =>
      pt.shouldSendToLago
    );
    const transactionsSkipped = processedTransactions.filter((pt) =>
      !pt.shouldSendToLago
    );
    const skippedNoSubscription = transactionsSkipped.filter((pt) =>
      pt.skipReason === "no_subscription"
    );
    const skippedNonUsagePlan = transactionsSkipped.filter((pt) =>
      pt.skipReason === "non_usage_plan"
    );

    eventsCreated = transactionsToSend.length;

    logger.info("Sync", "Transactions processed", {
      transactionsProcessed,
      eventsCreated,
      skippedNoSubscription: skippedNoSubscription.length,
      skippedNonUsagePlan: skippedNonUsagePlan.length,
    });

    if (skippedNoSubscription.length > 0) {
      logger.warn(
        "Sync",
        "Transactions have no subscription and will not be sent to Lago",
        {
          count: skippedNoSubscription.length,
          transactionIds: skippedNoSubscription.map((pt) =>
            pt.steveTransactionId
          ),
        },
      );
    }
    if (skippedNonUsagePlan.length > 0) {
      logger.info(
        "Sync",
        "Transactions on non-usage plans skipped (expected)",
        {
          count: skippedNonUsagePlan.length,
          transactionIds: skippedNonUsagePlan.map((pt) =>
            pt.steveTransactionId
          ),
        },
      );
    }

    if (transactionsToSend.length === 0) {
      // Tag linking segment
      const tagStats = await runTagSync(
        syncLogger,
        mappings,
        allTags,
        syncRun.id,
      );

      // Transaction sync segment - still save sync states for transactions without subscriptions
      syncLogger.startSegment("transaction_sync");
      syncLogger.info("No events to send to Lago", { transactionsProcessed });
      if (transactionsSkipped.length > 0) {
        syncLogger.info(
          "Saving sync states for transactions without subscriptions",
          {
            count: transactionsSkipped.length,
          },
        );
        const syncStateUpdates = transactionsSkipped.map((pt) => ({
          steveTransactionId: pt.steveTransactionId,
          lastSyncedMeterValue: pt.meterValueTo,
          totalKwhBilled: (
            Number(
              syncStateByTxId.get(pt.steveTransactionId)?.totalKwhBilled ?? 0,
            ) +
            pt.kwhDelta
          ).toFixed(6),
          lastSyncRunId: syncRun.id,
          isFinalized: pt.isFinal,
        }));
        await batchUpsertSyncStates(syncStateUpdates);
        syncLogger.info("Sync states saved");
      }
      await syncLogger.endSegment();

      await markSyncComplete(
        syncRun.id,
        transactionsProcessed,
        0,
        undefined,
        tagStats,
      );
      await safeRefreshChargerCache(syncRun.id);
      return {
        syncRunId: syncRun.id,
        transactionsProcessed,
        eventsCreated: 0,
        errors: [],
      };
    }

    // Tag linking segment
    const tagStats = await runTagSync(
      syncLogger,
      mappings,
      allTags,
      syncRun.id,
    );

    // Transaction sync segment
    syncLogger.startSegment("transaction_sync");

    // 7. Build Lago events (only for transactions with subscriptions)
    syncLogger.info("Building Lago events", {
      count: transactionsToSend.length,
    });
    const lagoEvents = buildLagoEvents(transactionsToSend);

    // 8. Send events to Lago in batches
    const eventBatches = batchEvents(lagoEvents);
    syncLogger.info("Sending events to Lago", {
      totalEvents: lagoEvents.length,
      batchCount: eventBatches.length,
    });

    // Track which batch indices were successfully sent to Lago
    const successfulBatchIndices = new Set<number>();

    for (let i = 0; i < eventBatches.length; i++) {
      const batch = eventBatches[i];
      try {
        syncLogger.debug(`Sending batch ${i + 1}/${eventBatches.length}`, {
          batchSize: batch.length,
        });
        await lagoClient.createBatchEvents(batch);
        successfulBatchIndices.add(i);
        syncLogger.info(
          `Batch ${i + 1}/${eventBatches.length} sent successfully`,
        );
      } catch (error) {
        const errorMsg = `Failed to send batch ${i + 1}: ${
          (error as Error).message
        }`;
        syncLogger.error(errorMsg);
        errors.push(errorMsg);
      }
    }

    // Determine which transactions were successfully sent to Lago
    const successfullySentTransactions = transactionsToSend.filter(
      (_, index) => successfulBatchIndices.has(Math.floor(index / BATCH_SIZE)),
    );

    // Combine successfully-sent transactions with those that had no subscription
    // (no-subscription transactions still need their sync state updated so we
    // don't reprocess them, but they don't get event records)
    const transactionsForSyncState = [
      ...successfullySentTransactions,
      ...transactionsSkipped,
    ];

    // 9. Update sync states and create event records atomically
    // Only for transactions that were actually sent to Lago successfully
    // (plus no-subscription transactions for sync state only)
    syncLogger.info("Updating sync states in database", {
      successfullySent: successfullySentTransactions.length,
      failedBatches: eventBatches.length - successfulBatchIndices.size,
      withoutSubscription: transactionsSkipped.length,
    });

    const syncStateUpdates: NewTransactionSyncState[] = transactionsForSyncState
      .map((pt) => ({
        steveTransactionId: pt.steveTransactionId,
        lastSyncedMeterValue: pt.meterValueTo,
        totalKwhBilled: (
          Number(
            syncStateByTxId.get(pt.steveTransactionId)?.totalKwhBilled ?? 0,
          ) +
          pt.kwhDelta
        ).toFixed(6),
        lastSyncRunId: syncRun.id,
        isFinalized: pt.isFinal,
      }));

    // 10. Create synced event records only for successfully-sent transactions
    const syncedEventRecords: NewSyncedTransactionEvent[] =
      successfullySentTransactions.map((pt) => ({
        steveTransactionId: pt.steveTransactionId,
        transactionSyncStateId: null, // Will be set by trigger or later
        lagoEventTransactionId: pt.lagoEventTransactionId,
        userMappingId: pt.userMappingId,
        kwhDelta: pt.kwhDelta.toFixed(6),
        meterValueFrom: pt.meterValueFrom,
        meterValueTo: pt.meterValueTo,
        isFinal: pt.isFinal,
        syncRunId: syncRun.id,
      }));

    syncLogger.debug("Persisting sync states and event records atomically", {
      syncStateCount: syncStateUpdates.length,
      eventRecordCount: syncedEventRecords.length,
    });

    // Wrap both DB writes in a single transaction for atomicity
    await atomicUpsertSyncStatesAndCreateEvents(
      syncStateUpdates,
      syncedEventRecords,
    );
    syncLogger.info("Sync states and event records persisted successfully");

    // Update eventsCreated to reflect only successfully-sent transactions
    eventsCreated = successfullySentTransactions.length;

    await syncLogger.endSegment(errors.length > 0 ? "warning" : undefined);

    // 11. Mark sync as complete
    await markSyncComplete(
      syncRun.id,
      transactionsProcessed,
      eventsCreated,
      errors,
      tagStats,
    );
    await safeRefreshChargerCache(syncRun.id);

    logger.info("Sync", "Sync run completed successfully", {
      syncRunId: syncRun.id,
      transactionsProcessed,
      eventsCreated,
      errorCount: errors.length,
    });

    return {
      syncRunId: syncRun.id,
      transactionsProcessed,
      eventsCreated,
      errors,
    };
  } catch (error) {
    const errorMsg = `Sync failed: ${(error as Error).message}`;
    logger.error("Sync", errorMsg, error as Error);
    errors.push(errorMsg);
    await markSyncFailed(syncRun.id, errors);
    throw error;
  }
}

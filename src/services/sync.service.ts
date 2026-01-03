import { steveClient } from "../lib/steve-client.ts";
import { lagoClient } from "../lib/lago-client.ts";
import type { TransactionWithCompletion } from "./transaction-processor.ts";
import { processTransactions } from "./transaction-processor.ts";
import { batchEvents, buildLagoEvents } from "./lago-event-builder.ts";
import {
  batchCreateSyncedEvents,
  batchUpsertSyncStates,
  createSyncRun,
  getActiveMappings,
  getRunningSync,
  getSyncStates,
  markSyncComplete,
  markSyncFailed,
} from "./sync-db.ts";
import type {
  NewSyncedTransactionEvent,
  NewTransactionSyncState,
} from "../db/schema.ts";
import { logger } from "../lib/utils/logger.ts";
import { buildMappingLookupWithInheritance } from "./mapping-resolver.ts";
import { syncTagStatus } from "./tag-sync.service.ts";

export interface SyncResult {
  syncRunId: number;
  transactionsProcessed: number;
  eventsCreated: number;
  errors: string[];
}

/**
 * Run incremental sync cycle
 *
 * This is the main entry point for the sync service.
 * It orchestrates the entire sync process:
 * 1. Fetch transactions from StEvE
 * 2. Calculate deltas
 * 3. Send events to Lago
 * 4. Update sync state
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
  logger.info("Sync", "Sync run created", { syncRunId: syncRun.id });

  try {
    // 2. Fetch active transactions (with latest meter values) from StEvE
    logger.info("Sync", "Fetching active transactions from StEvE");
    const activeTransactions = await steveClient.getActiveTransactions();
    logger.debug("Sync", "Active transactions fetched", {
      count: activeTransactions.length,
    });

    // 3. Fetch recently completed transactions (last 24h to catch any we missed)
    logger.info("Sync", "Fetching recently completed transactions");
    const recentlyCompleted = await steveClient
      .getRecentlyCompletedTransactions(24 * 60); // 24 hours
    logger.debug("Sync", "Recently completed transactions fetched", {
      count: recentlyCompleted.length,
    });

    // 4. Combine and dedupe (completed takes precedence)
    const allTransactions = new Map<number, TransactionWithCompletion>();
    for (const tx of activeTransactions) {
      allTransactions.set(tx.id, { ...tx, isCompleted: false });
    }
    for (const tx of recentlyCompleted) {
      allTransactions.set(tx.id, { ...tx, isCompleted: true });
    }

    logger.info("Sync", "Transactions combined and deduplicated", {
      activeCount: activeTransactions.length,
      recentlyCompletedCount: recentlyCompleted.length,
      totalUnique: allTransactions.size,
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
      try {
        logger.info("Sync", "Starting tag status synchronization");
        const tagSyncResult = await syncTagStatus(mappings, allTags);
        logger.info("Sync", "Tag status synchronization completed", {
          totalTags: tagSyncResult.totalTags,
          enabledTags: tagSyncResult.enabledTags,
          disabledTags: tagSyncResult.disabledTags,
          unchangedTags: tagSyncResult.unchangedTags,
          errorCount: tagSyncResult.errors.length,
        });
      } catch (error) {
        logger.error("Sync", "Tag sync failed (non-fatal)", {
          error: error instanceof Error ? error.message : String(error),
        });
        // Don't fail the entire sync if tag sync fails
      }

      await markSyncComplete(syncRun.id, 0, 0);
      return {
        syncRunId: syncRun.id,
        transactionsProcessed: 0,
        eventsCreated: 0,
        errors: [],
      };
    }

    // 5. Load existing sync states for these transactions
    const txIds = Array.from(allTransactions.keys());
    logger.debug("Sync", "Loading sync states", { transactionIds: txIds });
    const existingSyncStates = await getSyncStates(txIds);
    logger.debug("Sync", "Sync states loaded", {
      count: existingSyncStates.length,
    });

    // Create lookup map
    const syncStateByTxId = new Map(
      existingSyncStates.map((s) => [s.steveTransactionId, s])
    );

    // 6. Build mapping lookup with inheritance (child tags inherit parent mappings)
    const mappingByOcppTag = buildMappingLookupWithInheritance(mappings, allTags);

    logger.info("Sync", "User mappings loaded with inheritance", {
      directMappings: mappings.filter((m) => m.lagoSubscriptionExternalId).length,
      totalMappingsWithInheritance: mappingByOcppTag.size,
      inheritedMappings: mappingByOcppTag.size - mappings.filter((m) => m.lagoSubscriptionExternalId).length,
    });

    // 7. Process each transaction
    logger.info("Sync", "Processing transactions", {
      totalTransactions: allTransactions.size,
    });
    const processedTransactions = await processTransactions(
      allTransactions,
      syncStateByTxId,
      mappingByOcppTag,
      syncRun.id
    );

    transactionsProcessed = allTransactions.size;

    // Separate transactions that should be sent to Lago from those that shouldn't
    const transactionsToSend = processedTransactions.filter(pt => pt.shouldSendToLago);
    const transactionsWithoutSubscription = processedTransactions.filter(pt => !pt.shouldSendToLago);

    eventsCreated = transactionsToSend.length;

    logger.info("Sync", "Transactions processed", {
      transactionsProcessed,
      eventsCreated,
      transactionsWithoutSubscription: transactionsWithoutSubscription.length,
    });

    // Log warning if some transactions couldn't be sent
    if (transactionsWithoutSubscription.length > 0) {
      logger.warn("Sync", "Some transactions have no subscription and will not be sent to Lago", {
        count: transactionsWithoutSubscription.length,
        transactionIds: transactionsWithoutSubscription.map(pt => pt.steveTransactionId),
      });
    }

    if (transactionsToSend.length === 0) {
      logger.info("Sync", "No events to send to Lago, completing sync");

      // Still save sync states for transactions without subscriptions
      if (transactionsWithoutSubscription.length > 0) {
        logger.info("Sync", "Saving sync states for transactions without subscriptions");
        const syncStateUpdates = transactionsWithoutSubscription.map((pt) => ({
          steveTransactionId: pt.steveTransactionId,
          lastSyncedMeterValue: pt.meterValueTo,
          totalKwhBilled: (syncStateByTxId.get(pt.steveTransactionId)?.totalKwhBilled || 0) + pt.kwhDelta,
          lastSyncRunId: syncRun.id,
          isFinalized: pt.isFinal,
        }));
        await batchUpsertSyncStates(syncStateUpdates);
      }

      // Sync tag status even when there are no transactions
      try {
        logger.info("Sync", "Starting tag status synchronization");
        const tagSyncResult = await syncTagStatus(mappings, allTags);
        logger.info("Sync", "Tag status synchronization completed", {
          totalTags: tagSyncResult.totalTags,
          enabledTags: tagSyncResult.enabledTags,
          disabledTags: tagSyncResult.disabledTags,
          unchangedTags: tagSyncResult.unchangedTags,
          errorCount: tagSyncResult.errors.length,
        });
      } catch (error) {
        logger.error("Sync", "Tag sync failed (non-fatal)", {
          error: error instanceof Error ? error.message : String(error),
        });
        // Don't fail the entire sync if tag sync fails
      }

      await markSyncComplete(syncRun.id, transactionsProcessed, 0);
      return {
        syncRunId: syncRun.id,
        transactionsProcessed,
        eventsCreated: 0,
        errors: [],
      };
    }

    // 8. Build Lago events (only for transactions with subscriptions)
    logger.debug("Sync", "Building Lago events");
    const lagoEvents = buildLagoEvents(transactionsToSend);
    logger.debug("Sync", "Lago events built", { count: lagoEvents.length });

    // 9. Send events to Lago in batches
    const eventBatches = batchEvents(lagoEvents);
    logger.info("Sync", "Sending events to Lago", {
      totalEvents: lagoEvents.length,
      batchCount: eventBatches.length,
    });

    for (let i = 0; i < eventBatches.length; i++) {
      const batch = eventBatches[i];
      try {
        logger.debug("Sync", `Sending batch ${i + 1}/${eventBatches.length}`, {
          batchSize: batch.length,
        });
        await lagoClient.createBatchEvents(batch);
        logger.debug("Sync", `Batch ${i + 1}/${eventBatches.length} sent successfully`);
      } catch (error) {
        const errorMsg = `Failed to send batch ${i + 1}: ${
          (error as Error).message
        }`;
        logger.error("Sync", errorMsg, error as Error);
        errors.push(errorMsg);
      }
    }

    // 10. Update sync states in database (for ALL processed transactions)
    logger.info("Sync", "Updating sync states in database");
    const syncStateUpdates: NewTransactionSyncState[] = processedTransactions
      .map((pt) => ({
        steveTransactionId: pt.steveTransactionId,
        lastSyncedMeterValue: pt.meterValueTo,
        totalKwhBilled: (syncStateByTxId.get(pt.steveTransactionId)
          ?.totalKwhBilled || 0) + pt.kwhDelta,
        lastSyncRunId: syncRun.id,
        isFinalized: pt.isFinal,
      }));

    logger.debug("Sync", "Sync state updates prepared", {
      count: syncStateUpdates.length,
      sentToLago: transactionsToSend.length,
      savedWithoutSubscription: transactionsWithoutSubscription.length,
    });
    await batchUpsertSyncStates(syncStateUpdates);
    logger.debug("Sync", "Sync states updated successfully");

    // 11. Create synced event records
    logger.info("Sync", "Creating synced event records");
    const syncedEventRecords: NewSyncedTransactionEvent[] =
      processedTransactions.map((pt) => ({
        steveTransactionId: pt.steveTransactionId,
        transactionSyncStateId: null, // Will be set by trigger or later
        lagoEventTransactionId: pt.lagoEventTransactionId,
        userMappingId: pt.userMappingId,
        kwhDelta: pt.kwhDelta,
        meterValueFrom: pt.meterValueFrom,
        meterValueTo: pt.meterValueTo,
        isFinal: pt.isFinal,
        syncRunId: syncRun.id,
      }));

    logger.debug("Sync", "Synced event records prepared", {
      count: syncedEventRecords.length,
    });
    await batchCreateSyncedEvents(syncedEventRecords);
    logger.debug("Sync", "Synced event records created successfully");

    // 12. Sync tag status (enable/disable tags based on mappings)
    try {
      logger.info("Sync", "Starting tag status synchronization");
      const tagSyncResult = await syncTagStatus(mappings, allTags);
      logger.info("Sync", "Tag status synchronization completed", {
        totalTags: tagSyncResult.totalTags,
        enabledTags: tagSyncResult.enabledTags,
        disabledTags: tagSyncResult.disabledTags,
        unchangedTags: tagSyncResult.unchangedTags,
        errorCount: tagSyncResult.errors.length,
      });
    } catch (error) {
      logger.error("Sync", "Tag sync failed (non-fatal)", {
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't fail the entire sync if tag sync fails
    }

    // 13. Mark sync as complete
    await markSyncComplete(syncRun.id, transactionsProcessed, eventsCreated, errors);

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


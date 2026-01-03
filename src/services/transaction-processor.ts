import type { StEvETransaction } from "../lib/types/steve.ts";
import type { TransactionSyncState, UserMapping } from "../db/schema.ts";
import { logger } from "../lib/utils/logger.ts";

export interface ProcessedTransaction {
  steveTransactionId: number;
  userMappingId: number;
  lagoSubscriptionExternalId: string;
  kwhDelta: number;
  meterValueFrom: number;
  meterValueTo: number;
  isFinal: boolean;
  lagoEventTransactionId: string;
}

export interface TransactionWithCompletion extends StEvETransaction {
  isCompleted: boolean;
}

/**
 * Calculate kWh delta for a transaction
 *
 * @param tx - The transaction from StEvE
 * @param syncState - Existing sync state (if any)
 * @returns Delta in kWh, or null if no new usage
 */
export function calculateDelta(
  tx: TransactionWithCompletion,
  syncState: TransactionSyncState | null
): { kwhDelta: number; meterValueFrom: number; meterValueTo: number } | null {
  // Determine current meter value
  const currentValue = tx.isCompleted
    ? parseInt(tx.stopValue!, 10) // Completed: use stop value
    : parseInt((tx as any).latestMeterValue || tx.startValue, 10); // Active: use latest or start

  // Determine base meter value (where we left off last time)
  const baseValue = syncState
    ? syncState.lastSyncedMeterValue // Use last synced value
    : parseInt(tx.startValue, 10); // First time: use start value

  // Calculate delta in Wh
  const deltaWh = currentValue - baseValue;

  // Skip if no new usage (or negative, which shouldn't happen)
  if (deltaWh <= 0) {
    return null;
  }

  // Convert Wh to kWh
  const kwhDelta = deltaWh / 1000;

  return {
    kwhDelta,
    meterValueFrom: baseValue,
    meterValueTo: currentValue,
  };
}

/**
 * Process a single transaction
 *
 * @param tx - Transaction from StEvE
 * @param syncState - Existing sync state (if any)
 * @param mapping - User mapping for this OCPP tag
 * @param syncRunId - Current sync run ID
 * @returns Processed transaction data, or null if should be skipped
 */
export function processTransaction(
  tx: TransactionWithCompletion,
  syncState: TransactionSyncState | null,
  mapping: UserMapping | undefined,
  syncRunId: number
): ProcessedTransaction | null {
  logger.debug("TransactionProcessor", "Processing transaction", {
    transactionId: tx.id,
    ocppIdTag: tx.ocppIdTag,
    isCompleted: tx.isCompleted,
    hasMapping: !!mapping,
    hasSyncState: !!syncState,
  });

  // Skip if already finalized
  if (syncState?.isFinalized) {
    logger.debug("TransactionProcessor", "Transaction already finalized, skipping", {
      transactionId: tx.id,
    });
    return null;
  }

  // Skip if no mapping found
  if (!mapping) {
    logger.warn("TransactionProcessor", "No mapping found for OCPP tag, skipping", {
      transactionId: tx.id,
      ocppIdTag: tx.ocppIdTag,
    });
    return null;
  }

  // Skip if mapping doesn't have subscription
  if (!mapping.lagoSubscriptionExternalId) {
    logger.warn("TransactionProcessor", "Mapping has no subscription, skipping", {
      transactionId: tx.id,
      ocppIdTag: tx.ocppIdTag,
      mappingId: mapping.id,
    });
    return null;
  }

  // Calculate delta
  const delta = calculateDelta(tx, syncState);

  if (!delta) {
    logger.debug("TransactionProcessor", "No new usage, skipping", {
      transactionId: tx.id,
    });
    return null;
  }

  logger.debug("TransactionProcessor", "Delta calculated", {
    transactionId: tx.id,
    kwhDelta: delta.kwhDelta,
    meterValueFrom: delta.meterValueFrom,
    meterValueTo: delta.meterValueTo,
  });

  // Generate unique transaction ID for Lago (for idempotency)
  // Format: steve_tx_{id}_sync_{syncRunId}
  const lagoEventTransactionId = `steve_tx_${tx.id}_sync_${syncRunId}`;

  const result = {
    steveTransactionId: tx.id,
    userMappingId: mapping.id,
    lagoSubscriptionExternalId: mapping.lagoSubscriptionExternalId,
    kwhDelta: delta.kwhDelta,
    meterValueFrom: delta.meterValueFrom,
    meterValueTo: delta.meterValueTo,
    isFinal: tx.isCompleted,
    lagoEventTransactionId,
  };

  logger.debug("TransactionProcessor", "Transaction processed successfully", {
    transactionId: tx.id,
    kwhDelta: result.kwhDelta,
    isFinal: result.isFinal,
  });

  return result;
}

/**
 * Process multiple transactions in batch
 *
 * @param transactions - Map of transactions from StEvE
 * @param syncStates - Map of existing sync states
 * @param mappings - Map of user mappings by OCPP tag
 * @param syncRunId - Current sync run ID
 * @returns Array of processed transactions
 */
export function processTransactions(
  transactions: Map<number, TransactionWithCompletion>,
  syncStates: Map<number, TransactionSyncState>,
  mappings: Map<string, UserMapping>,
  syncRunId: number
): ProcessedTransaction[] {
  logger.info("TransactionProcessor", "Processing batch of transactions", {
    totalTransactions: transactions.size,
    syncStatesCount: syncStates.size,
    mappingsCount: mappings.size,
    syncRunId,
  });

  const processed: ProcessedTransaction[] = [];

  for (const [txId, tx] of transactions) {
    const syncState = syncStates.get(txId) || null;
    const mapping = mappings.get(tx.ocppIdTag);

    const result = processTransaction(tx, syncState, mapping, syncRunId);

    if (result) {
      processed.push(result);
    }
  }

  logger.info("TransactionProcessor", "Batch processing complete", {
    totalTransactions: transactions.size,
    processedCount: processed.length,
    skippedCount: transactions.size - processed.length,
  });

  return processed;
}


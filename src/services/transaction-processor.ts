import type { StEvETransaction } from "../lib/types/steve.ts";
import type { TransactionSyncState, UserMapping } from "../db/schema.ts";
import { logger } from "../lib/utils/logger.ts";
import { resolveSubscriptionId } from "./mapping-resolver.ts";

export interface ProcessedTransaction {
  steveTransactionId: number;
  userMappingId: number;
  lagoSubscriptionExternalId: string | null; // Null if no subscription found
  kwhDelta: number;
  meterValueFrom: number;
  meterValueTo: number;
  isFinal: boolean;
  lagoEventTransactionId: string;
  shouldSendToLago: boolean; // False if no subscription available
  stopTimestamp: string | null; // ISO timestamp of when the transaction stopped
}

export interface TransactionWithCompletion extends StEvETransaction {
  /** Always true in the current post-transaction billing model (only completed transactions are processed). */
  isCompleted: boolean;
}

/**
 * Calculate total kWh for a completed transaction
 *
 * Uses post-transaction billing: one event per completed session
 * with total energy delivered (stopValue - startValue).
 *
 * @param tx - The completed transaction from StEvE
 * @returns Total kWh and meter range, or null if invalid
 */
export function calculateDelta(
  tx: TransactionWithCompletion,
): { kwhDelta: number; meterValueFrom: number; meterValueTo: number } | null {
  // Only bill completed transactions
  if (!tx.isCompleted || !tx.stopValue) {
    return null;
  }

  const startValue = parseInt(tx.startValue, 10);
  const stopValue = parseInt(tx.stopValue, 10);
  const deltaWh = stopValue - startValue;

  // Skip if no usage (or negative, which shouldn't happen)
  if (deltaWh <= 0) {
    return null;
  }

  return {
    kwhDelta: deltaWh / 1000,
    meterValueFrom: startValue,
    meterValueTo: stopValue,
  };
}

/**
 * Process a single transaction
 *
 * @param tx - Transaction from StEvE
 * @param syncState - Existing sync state (if any)
 * @param mapping - User mapping for this OCPP tag
 * @returns Processed transaction data, or null if should be skipped
 */
export async function processTransaction(
  tx: TransactionWithCompletion,
  syncState: TransactionSyncState | null,
  mapping: UserMapping | undefined,
  subscriptionCache?: Map<string, string | null>,
): Promise<ProcessedTransaction | null> {
  logger.debug("TransactionProcessor", "Processing transaction", {
    transactionId: tx.id,
    ocppIdTag: tx.ocppIdTag,
    isCompleted: tx.isCompleted,
    hasMapping: !!mapping,
    hasSyncState: !!syncState,
  });

  // Skip if already finalized
  if (syncState?.isFinalized) {
    logger.debug(
      "TransactionProcessor",
      "Transaction already finalized, skipping",
      {
        transactionId: tx.id,
      },
    );
    return null;
  }

  // Skip if no mapping found
  if (!mapping) {
    logger.warn(
      "TransactionProcessor",
      "No mapping found for OCPP tag, skipping",
      {
        transactionId: tx.id,
        ocppIdTag: tx.ocppIdTag,
      },
    );
    return null;
  }

  // Try to resolve subscription (auto-select if not specified)
  const subscriptionId = await resolveSubscriptionId(mapping, subscriptionCache);

  if (!subscriptionId) {
    logger.warn(
      "TransactionProcessor",
      "No subscription available for mapping",
      {
        transactionId: tx.id,
        ocppIdTag: tx.ocppIdTag,
        mappingId: mapping.id,
        hasExplicitSubscription: !!mapping.lagoSubscriptionExternalId,
      },
    );
    // Continue processing but mark as not ready for Lago
  }

  // Calculate delta
  const delta = calculateDelta(tx);

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
  // Post-transaction billing: one event per completed session, deterministic ID
  const lagoEventTransactionId = `steve_tx_${tx.id}_final`;

  const result = {
    steveTransactionId: tx.id,
    userMappingId: mapping.id,
    lagoSubscriptionExternalId: subscriptionId,
    kwhDelta: delta.kwhDelta,
    meterValueFrom: delta.meterValueFrom,
    meterValueTo: delta.meterValueTo,
    isFinal: tx.isCompleted,
    lagoEventTransactionId,
    shouldSendToLago: !!subscriptionId, // Only send if we have a subscription
    stopTimestamp: tx.stopTimestamp,
  };

  logger.debug("TransactionProcessor", "Transaction processed successfully", {
    transactionId: tx.id,
    kwhDelta: result.kwhDelta,
    isFinal: result.isFinal,
    hasSubscription: !!subscriptionId,
    shouldSendToLago: result.shouldSendToLago,
  });

  return result;
}

/**
 * Process multiple transactions in batch
 *
 * @param transactions - Map of transactions from StEvE
 * @param syncStates - Map of existing sync states
 * @param mappings - Map of user mappings by OCPP tag
 * @returns Array of processed transactions
 */
export async function processTransactions(
  transactions: Map<number, TransactionWithCompletion>,
  syncStates: Map<number, TransactionSyncState>,
  mappings: Map<string, UserMapping>,
): Promise<ProcessedTransaction[]> {
  logger.info("TransactionProcessor", "Processing batch of transactions", {
    totalTransactions: transactions.size,
    syncStatesCount: syncStates.size,
    mappingsCount: mappings.size,
  });

  const processed: ProcessedTransaction[] = [];

  // Per-invocation cache for subscription lookups to avoid redundant Lago API calls
  // when multiple transactions share the same customer
  const subscriptionCache = new Map<string, string | null>();

  for (const [txId, tx] of transactions) {
    const syncState = syncStates.get(txId) || null;
    const mapping = mappings.get(tx.ocppIdTag);

    const result = await processTransaction(tx, syncState, mapping, subscriptionCache);

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

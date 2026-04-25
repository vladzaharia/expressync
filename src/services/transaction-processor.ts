import type { StEvETransaction } from "../lib/types/steve.ts";
import type { TransactionSyncState, UserMapping } from "../db/schema.ts";
import { logger } from "../lib/utils/logger.ts";
import {
  resolveSubscription,
  type SubscriptionResolutionCache,
} from "./mapping-resolver.ts";
import { createNotification } from "./notification.service.ts";
import { db } from "../db/index.ts";
import * as schema from "../db/schema.ts";
import { eq } from "drizzle-orm";

/**
 * Plan codes for which we intentionally do NOT post kWh events to Lago.
 * ExpressChargeM is a flat-rate membership plan — kWh usage is not billed
 * per-unit, and the current limit is enforced at the OCPP layer via a
 * StEvE charging profile rather than by Lago.
 */
const NON_USAGE_PLAN_CODES = new Set<string>(["ExpressChargeM"]);

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export interface ProcessedTransaction {
  steveTransactionId: number;
  userMappingId: number;
  lagoSubscriptionExternalId: string | null; // Null if no subscription found
  kwhDelta: number;
  meterValueFrom: number;
  meterValueTo: number;
  isFinal: boolean;
  lagoEventTransactionId: string;
  shouldSendToLago: boolean; // False if no subscription available or plan is non-usage
  skipReason:
    | "no_subscription"
    | "non_usage_plan"
    /**
     * Wave R: the incremental billing emitter has already pushed enough
     * events to Lago to cover (or exceed) the post-tx total. We still
     * want to finalize the sync state so this transaction isn't
     * reprocessed forever, but we must NOT emit a duplicate Lago event.
     */
    | "already_billed_incrementally"
    | null;
  stopTimestamp: string | null; // ISO timestamp of when the transaction stopped
  // === Phase D: event enrichment metadata (threaded through for lago events) ===
  chargeBoxId: string;
  connectorId: number;
  startTimestamp: string;
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
  subscriptionCache?: SubscriptionResolutionCache,
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
  const resolved = await resolveSubscription(mapping, subscriptionCache);
  const subscriptionId = resolved?.externalId ?? null;
  const planCode = resolved?.planCode ?? null;

  let skipReason: ProcessedTransaction["skipReason"] = null;

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
    skipReason = "no_subscription";
  } else if (planCode && NON_USAGE_PLAN_CODES.has(planCode)) {
    logger.info(
      "TransactionProcessor",
      "Skipping Lago event for non-usage plan",
      {
        transactionId: tx.id,
        ocppIdTag: tx.ocppIdTag,
        mappingId: mapping.id,
        subscriptionId,
        planCode,
      },
    );
    skipReason = "non_usage_plan";
  }

  // Calculate delta from StEvE's authoritative meter values.
  const fullDelta = calculateDelta(tx);

  if (!fullDelta) {
    logger.debug("TransactionProcessor", "No new usage, skipping", {
      transactionId: tx.id,
    });
    return null;
  }

  // Wave R — subtract anything already billed by the incremental emitter.
  // `transaction_sync_state.totalKwhBilled` is the running sum of every
  // per-tick event we've successfully pushed. A reconciliation pass either
  // sends a small "true-up" delta covering what incremental missed (e.g.
  // the first kWh before the receiver caught up) or, when incremental
  // covered everything, finalizes the sync state without sending anything.
  const priorBilledKwh = Number(syncState?.totalKwhBilled ?? 0);
  const remainingKwh = round6(fullDelta.kwhDelta - priorBilledKwh);

  // Tolerance: 1 Wh — guards against IEEE-754 noise. The incremental
  // emitter rounds to 6 decimals; sync-state Numeric(12,6) rounds the
  // same way; subtraction of two 6-dp values can leave a 1e-15 residue.
  const ALREADY_BILLED_TOLERANCE_KWH = 0.001;
  if (remainingKwh <= ALREADY_BILLED_TOLERANCE_KWH) {
    logger.info(
      "TransactionProcessor",
      "Reconciliation: incremental already covered this transaction",
      {
        transactionId: tx.id,
        fullKwh: fullDelta.kwhDelta,
        priorBilledKwh,
      },
    );
    return {
      steveTransactionId: tx.id,
      userMappingId: mapping.id,
      lagoSubscriptionExternalId: subscriptionId,
      kwhDelta: 0,
      meterValueFrom: fullDelta.meterValueFrom,
      meterValueTo: fullDelta.meterValueTo,
      isFinal: tx.isCompleted,
      // No Lago event will be sent — but we still pick a unique key in
      // case audit code logs it. The marker suffix avoids any chance of
      // colliding with a real `_final` event.
      lagoEventTransactionId: `steve_tx_${tx.id}_final_noop`,
      shouldSendToLago: false,
      skipReason: "already_billed_incrementally",
      stopTimestamp: tx.stopTimestamp,
      chargeBoxId: tx.chargeBoxId,
      connectorId: tx.connectorId,
      startTimestamp: tx.startTimestamp,
    };
  }

  // Reconciliation: bill only the gap. `meterValueFrom` advances to where
  // incremental left off so the audit row is accurate.
  const meterValueFrom = fullDelta.meterValueFrom +
    Math.round(priorBilledKwh * 1000);

  logger.debug("TransactionProcessor", "Delta calculated", {
    transactionId: tx.id,
    fullKwh: fullDelta.kwhDelta,
    priorBilledKwh,
    reconciliationKwh: remainingKwh,
    meterValueFrom,
    meterValueTo: fullDelta.meterValueTo,
  });

  // Generate unique transaction ID for Lago (for idempotency).
  // The reconciliation pass deliberately keeps the deterministic `_final`
  // suffix so it's distinct from incremental flush keys (`_<unixSec>`).
  const lagoEventTransactionId = `steve_tx_${tx.id}_final`;

  const result: ProcessedTransaction = {
    steveTransactionId: tx.id,
    userMappingId: mapping.id,
    lagoSubscriptionExternalId: subscriptionId,
    kwhDelta: remainingKwh,
    meterValueFrom,
    meterValueTo: fullDelta.meterValueTo,
    isFinal: tx.isCompleted,
    lagoEventTransactionId,
    shouldSendToLago: skipReason === null,
    skipReason,
    stopTimestamp: tx.stopTimestamp,
    // Phase D: threaded through for lago-event-builder enrichment.
    chargeBoxId: tx.chargeBoxId,
    connectorId: tx.connectorId,
    startTimestamp: tx.startTimestamp,
  };

  logger.debug("TransactionProcessor", "Transaction processed successfully", {
    transactionId: tx.id,
    kwhDelta: result.kwhDelta,
    isFinal: result.isFinal,
    hasSubscription: !!subscriptionId,
    planCode,
    shouldSendToLago: result.shouldSendToLago,
    skipReason: result.skipReason,
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
  const subscriptionCache: SubscriptionResolutionCache = new Map();

  for (const [txId, tx] of transactions) {
    const syncState = syncStates.get(txId) || null;
    const mapping = mappings.get(tx.ocppIdTag);

    const result = await processTransaction(
      tx,
      syncState,
      mapping,
      subscriptionCache,
    );

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

// ----------------------------------------------------------------------------
// Polaris Track H — session-complete customer notification
// ----------------------------------------------------------------------------

/**
 * Polaris Track H — fire `session.complete` customer notifications +
 * emails for newly-finalized transactions.
 *
 * Called from `sync.service.ts` AFTER `atomicUpsertSyncStatesAndCreateEvents`
 * succeeds. Receives the processed transactions (so we have kWh + finality
 * flag) plus the prior sync state map (so we can detect rows that flipped
 * `is_finalized` false → true on this run; rows that were already final
 * don't re-fire).
 *
 * Errors are caught per-transaction so one bad lookup doesn't break the
 * batch. Email dispatch happens inside `notification.service.ts`'s
 * post-create hook — this function only persists the notification row +
 * payload spec.
 */
export async function notifyFinalizedTransactions(
  processed: ProcessedTransaction[],
  priorSyncStates: Map<number, TransactionSyncState>,
  rawTransactions: Map<number, TransactionWithCompletion>,
): Promise<void> {
  // Filter to transactions that became newly-finalized on this run. A
  // transaction with no prior sync state but `isFinal=true` is the most
  // common case (transaction completed since last sync); a transaction
  // with prior state but `isFinalized=false` flipping true is also
  // possible (e.g. retry after a previous Lago failure).
  const newlyFinalized = processed.filter((pt) => {
    if (!pt.isFinal) return false;
    const prior = priorSyncStates.get(pt.steveTransactionId);
    return !prior?.isFinalized;
  });

  if (newlyFinalized.length === 0) return;

  for (const pt of newlyFinalized) {
    try {
      // Need user_mappings.user_id (customer link) + tag_type (card label)
      // for the email payload. Single SELECT keeps the per-tx cost low.
      const [mappingRow] = await db
        .select({
          userId: schema.userMappings.userId,
          displayName: schema.userMappings.displayName,
          steveOcppIdTag: schema.userMappings.steveOcppIdTag,
        })
        .from(schema.userMappings)
        .where(eq(schema.userMappings.id, pt.userMappingId))
        .limit(1);

      const userId = mappingRow?.userId;
      if (!userId) {
        // No customer link — happens for legacy mappings or
        // system-generated tags. Skip silently; admin tooling can
        // backfill later.
        continue;
      }

      // Best-effort charger label from the local cache. Falls back to
      // the chargeBoxId when no friendly name is set.
      const [chargerRow] = await db
        .select({ friendlyName: schema.chargersCache.friendlyName })
        .from(schema.chargersCache)
        .where(eq(schema.chargersCache.chargeBoxId, pt.chargeBoxId))
        .limit(1);
      const chargerName = chargerRow?.friendlyName ?? pt.chargeBoxId;

      // Compute friendly duration. Source data is the raw StEvE
      // transaction's start/stop timestamps which we've already threaded
      // through `pt.startTimestamp` / `pt.stopTimestamp`.
      const startedAt = new Date(pt.startTimestamp);
      const endedAt = pt.stopTimestamp
        ? new Date(pt.stopTimestamp)
        : new Date();
      const durationMin = Math.max(
        0,
        Math.round((endedAt.getTime() - startedAt.getTime()) / 60_000),
      );
      const durationStr = durationMin >= 60
        ? `${Math.floor(durationMin / 60)}h ${durationMin % 60}m`
        : `${durationMin} min`;

      // Card label — prefer the operator-set friendly name, fall back
      // to the OCPP idTag (which is what the customer scanned).
      const cardLabel = mappingRow.displayName ?? mappingRow.steveOcppIdTag;

      // Body copy lifted to summary line — kept short for the in-app
      // bell. The email template includes the full breakdown.
      const energyStr = `${pt.kwhDelta.toFixed(2)} kWh`;

      await createNotification({
        kind: "session.complete",
        severity: "success",
        title: "Charging session ended",
        body:
          `Your session at ${chargerName} ended — ${energyStr} over ${durationStr}.`,
        sourceType: "system",
        sourceId: String(pt.steveTransactionId),
        audience: "customer",
        userId,
        context: {
          steveTransactionId: pt.steveTransactionId,
          chargeBoxId: pt.chargeBoxId,
          connectorId: pt.connectorId,
          kwhDelta: pt.kwhDelta,
          startedAt: startedAt.toISOString(),
          endedAt: endedAt.toISOString(),
        },
        emailPayload: {
          kind: "session.complete",
          session: {
            id: String(pt.steveTransactionId),
            chargerName,
            started: startedAt.toLocaleString("en-US", {
              year: "numeric",
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            }),
            ended: endedAt.toLocaleString("en-US", {
              year: "numeric",
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            }),
            duration: durationStr,
            energy: energyStr,
            // Cost is computed downstream by Lago and is not yet known at
            // session-end time. Leaving `cost` undefined makes the email
            // template render the "cost will be available shortly" note.
            cardLabel,
          },
        },
      });
    } catch (err) {
      logger.warn(
        "TransactionProcessor",
        "session.complete notification failed (non-blocking)",
        {
          steveTransactionId: pt.steveTransactionId,
          error: err instanceof Error ? err.message : String(err),
        },
      );
    }
  }

  // Suppress unused-var warning when caller passes the raw map but we
  // only use the processed projection. Keeping the signature flexible
  // for future enrichment without forcing a call-site change.
  void rawTransactions;
}

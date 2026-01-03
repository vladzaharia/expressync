import type { LagoEvent } from "../lib/types/lago.ts";
import type { ProcessedTransaction } from "./transaction-processor.ts";
import { config } from "../lib/config.ts";
import { logger } from "../lib/utils/logger.ts";

/**
 * Build a Lago event from a processed transaction
 *
 * @param processed - Processed transaction data
 * @returns Lago event ready to send
 */
export function buildLagoEvent(processed: ProcessedTransaction): LagoEvent {
  logger.debug("LagoEventBuilder", "Building Lago event", {
    transactionId: processed.steveTransactionId,
    kwhDelta: processed.kwhDelta,
    subscriptionId: processed.lagoSubscriptionExternalId,
  });

  const event = {
    transaction_id: processed.lagoEventTransactionId,
    external_subscription_id: processed.lagoSubscriptionExternalId,
    code: config.LAGO_METRIC_CODE,
    timestamp: Math.floor(Date.now() / 1000), // Unix timestamp in seconds
    properties: {
      kwh: processed.kwhDelta.toFixed(3), // Round to 3 decimal places
    },
  };

  logger.debug("LagoEventBuilder", "Lago event built", {
    eventTransactionId: event.transaction_id,
    kwh: event.properties.kwh,
  });

  return event;
}

/**
 * Build multiple Lago events from processed transactions
 *
 * @param processedTransactions - Array of processed transactions
 * @returns Array of Lago events
 */
export function buildLagoEvents(
  processedTransactions: ProcessedTransaction[]
): LagoEvent[] {
  logger.info("LagoEventBuilder", "Building Lago events", {
    count: processedTransactions.length,
  });

  const events = processedTransactions.map(buildLagoEvent);

  logger.debug("LagoEventBuilder", "Lago events built", {
    count: events.length,
  });

  return events;
}

/**
 * Split events into batches for Lago API
 * Lago accepts up to 100 events per batch
 *
 * @param events - Array of events to batch
 * @param batchSize - Size of each batch (default: 100)
 * @returns Array of event batches
 */
export function batchEvents(
  events: LagoEvent[],
  batchSize: number = 100
): LagoEvent[][] {
  logger.debug("LagoEventBuilder", "Batching events", {
    totalEvents: events.length,
    batchSize,
  });

  const batches: LagoEvent[][] = [];

  for (let i = 0; i < events.length; i += batchSize) {
    batches.push(events.slice(i, i + batchSize));
  }

  logger.debug("LagoEventBuilder", "Events batched", {
    totalEvents: events.length,
    batchCount: batches.length,
    batchSize,
  });

  return batches;
}


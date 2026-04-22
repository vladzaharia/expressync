import type { LagoEvent } from "../lib/types/lago.ts";
import type { ProcessedTransaction } from "./transaction-processor.ts";
import { config } from "../lib/config.ts";
import { logger } from "../lib/utils/logger.ts";

/** Maximum number of events per Lago API batch request */
export const BATCH_SIZE = 100;

/**
 * Primary event-property key. Must match the Lago billable metric's
 * `field_name` (see `ensureLagoMetricSafety`). Lago's `sum_agg` pulls this
 * property from each event; any mismatch silently aggregates to 0 (no
 * webhook, no error). We hard-code `value` because it's Lago's default
 * `field_name` and what our metric is set to — the safety gate re-verifies
 * at startup and loudly errors on drift.
 *
 * Belt-and-braces: every event also carries a redundant `kwh` alias
 * (`LAGO_METRIC_ALIAS_KEY`) holding the same number. Lago ignores unknown
 * properties for aggregation, so this is free insurance if the metric's
 * field_name ever flips to `kwh`, and useful for human operators reading
 * event payloads directly.
 */
export const LAGO_METRIC_FIELD_NAME = "value" as const;
export const LAGO_METRIC_ALIAS_KEY = "kwh" as const;

/**
 * Phase D safety gate: enriched event properties (charger_id, connector_id,
 * session_duration_minutes, start/stop timestamps) are only emitted when this
 * flag is true. The startup safety gate (`src/services/lago-safety.service.ts`)
 * calls `setSafeEnrichment(false)` if the billable metric's aggregation type
 * is not `sum_agg` OR its `field_name` doesn't match `LAGO_METRIC_FIELD_NAME`
 * — in that case we fall back to a minimal payload to avoid accidentally
 * aggregating an enrichment property.
 */
let SAFE_ENRICHMENT = true;

/** Get current value of the SAFE_ENRICHMENT flag (for tests/introspection). */
export function isSafeEnrichmentEnabled(): boolean {
  return SAFE_ENRICHMENT;
}

/** Toggle enriched event properties. Called by the startup safety gate. */
export function setSafeEnrichment(enabled: boolean): void {
  SAFE_ENRICHMENT = enabled;
}

/**
 * Compute session duration in minutes from start/stop timestamps.
 * Returns 0 when stopTimestamp is null (active session).
 */
function computeDurationMinutes(
  startTimestamp: string,
  stopTimestamp: string | null,
): number {
  if (!stopTimestamp) return 0;
  const startMs = new Date(startTimestamp).getTime();
  const stopMs = new Date(stopTimestamp).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(stopMs)) return 0;
  const diffMs = stopMs - startMs;
  if (diffMs <= 0) return 0;
  return Math.round(diffMs / 60000);
}

/**
 * Build a Lago event from a processed transaction
 *
 * @param processed - Processed transaction data
 * @returns Lago event ready to send
 */
export function buildLagoEvent(processed: ProcessedTransaction): LagoEvent {
  if (!processed.lagoSubscriptionExternalId) {
    throw new Error(
      `Cannot build Lago event: no subscription ID for transaction ${processed.steveTransactionId}`,
    );
  }

  logger.debug("LagoEventBuilder", "Building Lago event", {
    transactionId: processed.steveTransactionId,
    kwhDelta: processed.kwhDelta,
    subscriptionId: processed.lagoSubscriptionExternalId,
    safeEnrichment: SAFE_ENRICHMENT,
  });

  // Use the transaction's actual stop time for post-transaction billing;
  // fall back to current time if stopTimestamp is somehow unavailable.
  const timestamp = processed.stopTimestamp
    ? Math.floor(new Date(processed.stopTimestamp).getTime() / 1000)
    : Math.floor(Date.now() / 1000);

  // Always round kWh to 3 decimal places — billing precision lives in the
  // metric configuration.
  const kwh = processed.kwhDelta.toFixed(3);

  // Phase D: enrich event properties with charger/connector/duration context
  // so Lago can segment usage. Gated on SAFE_ENRICHMENT because these extras
  // are only safe when aggregation_type === "sum_agg" and field_name matches
  // LAGO_METRIC_FIELD_NAME — otherwise a misconfigured metric could start
  // aggregating `charger_id` (etc.) as a unique_count or similar and silently
  // corrupt bills.
  const properties: Record<string, string | number> = SAFE_ENRICHMENT
    ? {
      [LAGO_METRIC_FIELD_NAME]: kwh,
      [LAGO_METRIC_ALIAS_KEY]: kwh,
      charger_id: processed.chargeBoxId,
      connector_id: String(processed.connectorId),
      session_duration_minutes: String(
        computeDurationMinutes(
          processed.startTimestamp,
          processed.stopTimestamp,
        ),
      ),
      start_timestamp: processed.startTimestamp,
      stop_timestamp: processed.stopTimestamp ?? "",
    }
    : {
      [LAGO_METRIC_FIELD_NAME]: kwh,
      [LAGO_METRIC_ALIAS_KEY]: kwh,
    };

  const event: LagoEvent = {
    transaction_id: processed.lagoEventTransactionId,
    external_subscription_id: processed.lagoSubscriptionExternalId,
    code: config.LAGO_METRIC_CODE,
    timestamp,
    properties,
  };

  logger.debug("LagoEventBuilder", "Lago event built", {
    eventTransactionId: event.transaction_id,
    [LAGO_METRIC_FIELD_NAME]: event.properties[LAGO_METRIC_FIELD_NAME],
    enriched: SAFE_ENRICHMENT,
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
  processedTransactions: ProcessedTransaction[],
): LagoEvent[] {
  logger.info("LagoEventBuilder", "Building Lago events", {
    count: processedTransactions.length,
    safeEnrichment: SAFE_ENRICHMENT,
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
 * @param batchSize - Size of each batch (default: BATCH_SIZE)
 * @returns Array of event batches
 */
export function batchEvents(
  events: LagoEvent[],
  batchSize: number = BATCH_SIZE,
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

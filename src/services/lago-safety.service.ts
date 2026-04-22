/**
 * Lago Safety Service — Phase D startup gate.
 *
 * On web-app + worker startup we verify that the configured billable metric
 * (`config.LAGO_METRIC_CODE`) has `aggregation_type === "sum_agg"`. If it
 * doesn't, we flip the `SAFE_ENRICHMENT` flag in `lago-event-builder` off —
 * subsequent events will be sent with `kwh` only, avoiding the risk that a
 * misconfigured metric (e.g. changed to `unique_count_agg`) would start
 * aggregating an enrichment property like `charger_id` and silently break
 * billing.
 *
 * Never blocks startup. Silent on success; loud on failure.
 */

import { lagoClient } from "../lib/lago-client.ts";
import { config } from "../lib/config.ts";
import { logger } from "../lib/utils/logger.ts";
import {
  LAGO_METRIC_FIELD_NAME,
  setSafeEnrichment,
} from "./lago-event-builder.ts";

const log = logger.child("LagoSafety");

/** Track whether the gate has already run this process. */
let checked = false;

/**
 * Run the startup safety gate. Safe to call multiple times — only the first
 * invocation hits Lago.
 *
 * Two invariants are verified:
 *   1. `aggregation_type === "sum_agg"` — anything else means our kWh deltas
 *      aren't summed correctly.
 *   2. `field_name === LAGO_METRIC_FIELD_NAME` — Lago only aggregates the
 *      named property; a mismatch silently produces $0 invoices.
 *
 * On either failure we flip enrichment off AND log an ERROR. We do NOT
 * block startup — degraded billing is recoverable, a dead worker is not.
 */
export async function ensureLagoMetricSafety(): Promise<void> {
  if (checked) return;
  checked = true;

  const metricCode = config.LAGO_METRIC_CODE;
  try {
    const { billable_metric } = await lagoClient.getBillableMetric(metricCode);

    const aggOk = billable_metric.aggregation_type === "sum_agg";
    const fieldOk = billable_metric.field_name === LAGO_METRIC_FIELD_NAME;

    if (aggOk && fieldOk) {
      log.debug("Lago metric safety checks passed", {
        code: metricCode,
        aggregation_type: billable_metric.aggregation_type,
        field_name: billable_metric.field_name,
      });
      setSafeEnrichment(true);
      return;
    }

    if (!aggOk) {
      log.error(
        "Lago metric aggregation type is not sum_agg; disabling event property enrichment",
        {
          code: metricCode,
          aggregation_type: billable_metric.aggregation_type,
          expected: "sum_agg",
        },
      );
    }
    if (!fieldOk) {
      log.error(
        "Lago metric field_name does not match what the event builder emits; events will silently aggregate to 0",
        {
          code: metricCode,
          actual: billable_metric.field_name,
          expected: LAGO_METRIC_FIELD_NAME,
        },
      );
    }
    setSafeEnrichment(false);
  } catch (err) {
    // Don't block startup on a network hiccup, but degrade to safe mode
    // so we can't accidentally emit enrichment against an unknown metric state.
    log.error("Failed to verify Lago billable metric safety", {
      code: metricCode,
      error: err instanceof Error ? err.message : String(err),
    });
    setSafeEnrichment(false);
  }
}

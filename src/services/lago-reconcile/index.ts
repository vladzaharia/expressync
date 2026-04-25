/**
 * Lago entity reconciliation — pulls Lago's view of customers, subscriptions,
 * plans, invoices, wallets, and billable metrics into local cache tables with
 * Lago as the source of truth. Runs as its own sync segment per entity so the
 * admin sync UI can render per-entity logs and status.
 *
 * Orphan handling: entities that exist locally but are no longer returned by
 * Lago are soft-marked via `deleted_at`. Any subsequent upsert clears
 * `deleted_at`, so a re-created Lago entity with the same `lago_id`
 * automatically re-activates the cached row.
 *
 * Invoked from `runSync()` after the transaction-billing segment (which is
 * the only segment that mutates Lago) so reconciliation captures our own
 * writes.
 */

import { reconcileLagoBillableMetrics } from "./billable-metrics.ts";
import { reconcileLagoCustomers } from "./customers.ts";
import { reconcileLagoInvoices } from "./invoices.ts";
import { reconcileLagoPlans } from "./plans.ts";
import { reconcileLagoSubscriptions } from "./subscriptions.ts";
import { reconcileLagoWallets } from "./wallets.ts";
import { reconcileLocalState } from "./local.ts";
import type { SyncLogger } from "../sync-logger.ts";
import { runReconcileSegment } from "./util.ts";
import type { ReconcileResult } from "./util.ts";

export type { ReconcileError, ReconcileResult } from "./util.ts";
export {
  reconcileLagoBillableMetrics,
  reconcileLagoCustomers,
  reconcileLagoInvoices,
  reconcileLagoPlans,
  reconcileLagoSubscriptions,
  reconcileLagoWallets,
  reconcileLocalState,
};
export { softDeleteCustomer, upsertCustomer } from "./customers.ts";
export { softDeleteSubscription, upsertSubscription } from "./subscriptions.ts";
export { upsertPlan } from "./plans.ts";
export { softDeleteInvoice, upsertInvoice } from "./invoices.ts";
export { softDeleteWallet, upsertWallet } from "./wallets.ts";

/**
 * Run every reconcile segment sequentially in dependency order. Per-entity
 * errors are captured in each `ReconcileResult.errors` and never abort the
 * outer loop — worst case we'll pick it up on the next sync.
 */
export async function runLagoReconcile(
  logger: SyncLogger,
): Promise<ReconcileResult[]> {
  const results: ReconcileResult[] = [];

  // Order matters so that downstream entities can join to upstream ones:
  //   billable metrics → plans → customers → subscriptions → invoices → wallets
  // (wallets is last because `reconcileLagoWallets` iterates customers from
  // the cache we just populated.)
  results.push(
    await runReconcileSegment(
      logger,
      "lago_billable_metrics",
      reconcileLagoBillableMetrics,
    ),
  );
  results.push(
    await runReconcileSegment(logger, "lago_plans", reconcileLagoPlans),
  );
  results.push(
    await runReconcileSegment(
      logger,
      "lago_customers",
      reconcileLagoCustomers,
    ),
  );
  results.push(
    await runReconcileSegment(
      logger,
      "lago_subscriptions",
      reconcileLagoSubscriptions,
    ),
  );
  results.push(
    await runReconcileSegment(
      logger,
      "lago_invoices",
      reconcileLagoInvoices,
    ),
  );
  results.push(
    await runReconcileSegment(logger, "lago_wallets", reconcileLagoWallets),
  );

  // Local-state reconcile runs last because it consumes the caches we just
  // populated to provision users + flag orphan mappings.
  results.push(
    await runReconcileSegment(logger, "local_reconcile", reconcileLocalState),
  );

  return results;
}

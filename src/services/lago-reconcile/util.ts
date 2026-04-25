import type { SyncLogger } from "../sync-logger.ts";

export interface ReconcileError {
  message: string;
  lagoId?: string;
}

export interface ReconcileResult {
  entity: string;
  fetched: number;
  upserted: number;
  orphaned: number;
  durationMs: number;
  errors: ReconcileError[];
}

/**
 * Parse a Lago timestamp string into a JS Date. Lago emits ISO 8601 strings
 * (typically with `Z`); we normalize defensively and return null on empty /
 * parse failure so callers can write NULL into `lago_updated_at`.
 */
export function parseLagoTimestamp(
  value: string | null | undefined,
): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Diff a fresh Lago-id set against the local set. Any local id not in the
 * fresh set is treated as an orphan and should be soft-deleted by the caller.
 */
export function findOrphans(
  freshIds: Iterable<string>,
  localIds: Iterable<string>,
): string[] {
  const fresh = new Set(freshIds);
  const orphans: string[] = [];
  for (const id of localIds) {
    if (!fresh.has(id)) orphans.push(id);
  }
  return orphans;
}

/**
 * Thin wrapper so reconcilers can hand off a single logger handle and get
 * consistent start/end log lines.
 */
export async function runReconcileSegment(
  logger: SyncLogger,
  segment:
    | "lago_customers"
    | "lago_subscriptions"
    | "lago_plans"
    | "lago_invoices"
    | "lago_wallets"
    | "lago_billable_metrics"
    | "local_reconcile",
  fn: () => Promise<ReconcileResult>,
): Promise<ReconcileResult> {
  logger.startSegment(segment);
  const start = Date.now();
  try {
    const result = await fn();
    logger.info(`${segment} reconcile complete`, {
      fetched: result.fetched,
      upserted: result.upserted,
      orphaned: result.orphaned,
      errors: result.errors.length,
      durationMs: result.durationMs,
    });
    if (result.errors.length > 0) {
      for (const err of result.errors.slice(0, 10)) {
        logger.warn(`${segment} reconcile error`, {
          lagoId: err.lagoId,
          message: err.message,
        });
      }
      await logger.endSegment("warning");
    } else if (result.orphaned > 0) {
      // Orphans are a legitimate reconciliation outcome, not a warning.
      await logger.endSegment();
    } else {
      await logger.endSegment();
    }
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`${segment} reconcile threw`, { error: msg });
    await logger.endSegment("error");
    return {
      entity: segment,
      fetched: 0,
      upserted: 0,
      orphaned: 0,
      durationMs: Date.now() - start,
      errors: [{ message: msg }],
    };
  }
}

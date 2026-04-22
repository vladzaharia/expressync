import { db } from "../db/index.ts";
import {
  type NewSyncedTransactionEvent,
  type NewTransactionSyncState,
  syncedTransactionEvents,
  type SyncRun,
  type SyncRunLog,
  syncRunLogs,
  syncRuns,
  type TransactionSyncState,
  transactionSyncState,
  type UserMapping,
  userMappings,
} from "../db/schema.ts";
import { and, count, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { logger } from "../lib/utils/logger.ts";

/**
 * Create a new sync run record
 */
export async function createSyncRun(): Promise<{ id: number }> {
  logger.debug("SyncDB", "Creating new sync run");

  const [syncRun] = await db
    .insert(syncRuns)
    .values({ status: "running" })
    .returning({ id: syncRuns.id });

  logger.debug("SyncDB", "Sync run created", { syncRunId: syncRun.id });

  return syncRun;
}

/**
 * Check if there's already a running sync
 */
export async function getRunningSync(): Promise<{ id: number } | null> {
  const STALE_SYNC_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

  logger.debug("SyncDB", "Checking for running sync");

  const [runningSync] = await db
    .select({ id: syncRuns.id, startedAt: syncRuns.startedAt })
    .from(syncRuns)
    .where(eq(syncRuns.status, "running"))
    .limit(1);

  if (!runningSync) {
    logger.debug("SyncDB", "No running sync found");
    return null;
  }

  // Check if the running sync is stale
  const elapsed = Date.now() - runningSync.startedAt.getTime();
  if (elapsed > STALE_SYNC_TIMEOUT_MS) {
    logger.warn("SyncDB", "Found stale sync run, marking as failed", {
      syncRunId: runningSync.id,
      elapsedMs: elapsed,
    });
    await markSyncFailed(runningSync.id, [
      "Sync timed out (stale lock detected)",
    ]);
    return null;
  }

  logger.debug("SyncDB", "Found running sync", { syncRunId: runningSync.id });
  return runningSync;
}

export interface TagSyncStats {
  activatedTags: number;
  deactivatedTags: number;
  unchangedTags: number;
}

/**
 * Mark a sync run as completed
 */
export async function markSyncComplete(
  syncRunId: number,
  transactionsProcessed: number,
  eventsCreated: number,
  errors?: string[],
  tagStats?: TagSyncStats,
): Promise<void> {
  logger.debug("SyncDB", "Marking sync run as complete", {
    syncRunId,
    transactionsProcessed,
    eventsCreated,
    errorCount: errors?.length || 0,
    tagStats,
  });

  await db
    .update(syncRuns)
    .set({
      status: "completed",
      completedAt: new Date(),
      transactionsProcessed,
      eventsCreated,
      errors: errors && errors.length > 0 ? JSON.stringify(errors) : null,
      tagsActivated: tagStats?.activatedTags ?? 0,
      tagsDeactivated: tagStats?.deactivatedTags ?? 0,
      tagsUnchanged: tagStats?.unchangedTags ?? 0,
    })
    .where(eq(syncRuns.id, syncRunId));

  logger.debug("SyncDB", "Sync run marked as complete", { syncRunId });
}

/**
 * Mark a sync run as failed
 */
export async function markSyncFailed(
  syncRunId: number,
  errors: string[],
): Promise<void> {
  logger.error("SyncDB", "Marking sync run as failed", {
    syncRunId,
    errors,
  });

  await db
    .update(syncRuns)
    .set({
      status: "failed",
      completedAt: new Date(),
      errors: JSON.stringify(errors),
    })
    .where(eq(syncRuns.id, syncRunId));

  logger.debug("SyncDB", "Sync run marked as failed", { syncRunId });
}

/**
 * Get sync states for multiple transactions
 */
export async function getSyncStates(
  transactionIds: number[],
): Promise<TransactionSyncState[]> {
  if (transactionIds.length === 0) {
    logger.debug("SyncDB", "No transaction IDs provided for sync states");
    return [];
  }

  logger.debug("SyncDB", "Fetching sync states", {
    transactionCount: transactionIds.length,
  });

  const states = await db
    .select()
    .from(transactionSyncState)
    .where(inArray(transactionSyncState.steveTransactionId, transactionIds));

  logger.debug("SyncDB", "Sync states fetched", {
    requestedCount: transactionIds.length,
    foundCount: states.length,
  });

  return states;
}

/**
 * Get active user mappings with subscription info
 */
export async function getActiveMappings(): Promise<UserMapping[]> {
  logger.debug("SyncDB", "Fetching active user mappings");

  const mappings = await db
    .select()
    .from(userMappings)
    .where(eq(userMappings.isActive, true));

  logger.debug("SyncDB", "Active user mappings fetched", {
    count: mappings.length,
  });

  return mappings;
}

/**
 * Upsert transaction sync state
 */
export async function upsertSyncState(
  data: NewTransactionSyncState,
): Promise<void> {
  await db
    .insert(transactionSyncState)
    .values(data)
    .onConflictDoUpdate({
      target: transactionSyncState.steveTransactionId,
      set: {
        lastSyncedMeterValue: data.lastSyncedMeterValue,
        totalKwhBilled: data.totalKwhBilled,
        lastSyncRunId: data.lastSyncRunId,
        isFinalized: data.isFinalized,
        updatedAt: new Date(),
      },
    });
}

/**
 * Batch upsert sync states
 */
export async function batchUpsertSyncStates(
  states: NewTransactionSyncState[],
): Promise<void> {
  if (states.length === 0) {
    logger.debug("SyncDB", "No sync states to upsert");
    return;
  }

  logger.debug("SyncDB", "Upserting batch of sync states", {
    count: states.length,
  });

  for (const state of states) {
    await upsertSyncState(state);
  }

  logger.debug("SyncDB", "Sync states upserted", { count: states.length });
}

/**
 * Atomically upsert sync states and create synced event records in a single
 * database transaction. This ensures that if either operation fails, neither
 * is persisted -- preventing sync state from advancing without a corresponding
 * event record (or vice versa).
 */
export async function atomicUpsertSyncStatesAndCreateEvents(
  states: NewTransactionSyncState[],
  events: NewSyncedTransactionEvent[],
): Promise<void> {
  if (states.length === 0 && events.length === 0) {
    logger.debug("SyncDB", "No sync states or events to persist atomically");
    return;
  }

  logger.debug("SyncDB", "Atomically persisting sync states and events", {
    statesCount: states.length,
    eventsCount: events.length,
  });

  await db.transaction(async (tx) => {
    // Upsert sync states
    for (const state of states) {
      await tx
        .insert(transactionSyncState)
        .values(state)
        .onConflictDoUpdate({
          target: transactionSyncState.steveTransactionId,
          set: {
            lastSyncedMeterValue: state.lastSyncedMeterValue,
            totalKwhBilled: state.totalKwhBilled,
            lastSyncRunId: state.lastSyncRunId,
            isFinalized: state.isFinalized,
            updatedAt: new Date(),
          },
        });
    }

    // Create synced event records
    if (events.length > 0) {
      await tx.insert(syncedTransactionEvents).values(events);
    }
  });

  logger.debug("SyncDB", "Atomic persist complete", {
    statesCount: states.length,
    eventsCount: events.length,
  });
}

export interface SyncRunFilters {
  status?: "completed" | "failed" | "running";
  from?: Date;
  to?: Date;
  /**
   * Filter to runs where the chosen segment is non-success. For the
   * schema-backed segments (`tag_linking`, `transaction_sync`) this matches
   * rows whose status column is `warning`, `error`, or NULL (segment not yet
   * populated).
   *
   * `scheduling` has no dedicated column on `sync_runs`, so it is filtered
   * via an EXISTS on `sync_run_logs` with `segment = 'scheduling'` and
   * `level IN ('error', 'warn')`.
   */
  segment?: "tag_linking" | "transaction_sync" | "scheduling";
}

// deno-lint-ignore no-explicit-any
function buildSyncRunFilterConditions(filters?: SyncRunFilters): any[] {
  // deno-lint-ignore no-explicit-any
  const conditions: any[] = [];
  if (!filters) return conditions;

  if (filters.status) {
    conditions.push(eq(syncRuns.status, filters.status));
  }
  if (filters.from) {
    conditions.push(gte(syncRuns.startedAt, filters.from));
  }
  if (filters.to) {
    conditions.push(lte(syncRuns.startedAt, filters.to));
  }
  if (filters.segment === "tag_linking") {
    conditions.push(
      or(
        eq(syncRuns.tagLinkingStatus, "warning"),
        eq(syncRuns.tagLinkingStatus, "error"),
        sql`${syncRuns.tagLinkingStatus} IS NULL`,
      ),
    );
  } else if (filters.segment === "transaction_sync") {
    conditions.push(
      or(
        eq(syncRuns.transactionSyncStatus, "warning"),
        eq(syncRuns.transactionSyncStatus, "error"),
        sql`${syncRuns.transactionSyncStatus} IS NULL`,
      ),
    );
  } else if (filters.segment === "scheduling") {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM ${syncRunLogs} srl WHERE srl.sync_run_id = ${syncRuns.id} AND srl.segment = 'scheduling' AND srl.level IN ('error','warn'))`,
    );
  }
  return conditions;
}

/**
 * Get recent sync runs with pagination
 */
export async function getSyncRuns(
  limit: number = 20,
  offset: number = 0,
  filters?: SyncRunFilters,
): Promise<SyncRun[]> {
  logger.debug("SyncDB", "Fetching sync runs", { limit, offset, filters });

  const conditions = buildSyncRunFilterConditions(filters);
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const runs = await db
    .select()
    .from(syncRuns)
    .where(whereClause)
    .orderBy(desc(syncRuns.startedAt))
    .limit(limit)
    .offset(offset);

  logger.debug("SyncDB", "Sync runs fetched", { count: runs.length });

  return runs;
}

/**
 * Get total count of sync runs
 */
export async function getSyncRunsCount(
  filters?: SyncRunFilters,
): Promise<number> {
  const conditions = buildSyncRunFilterConditions(filters);
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ value }] = await db
    .select({ value: count() })
    .from(syncRuns)
    .where(whereClause);
  return value;
}

export interface SyncListStats {
  runs24h: number;
  successRate7d: number; // 0-100, or 0 when no runs
  avgDurationSec7d: number; // seconds; 0 when no finished runs
  lastRun: { status: string; startedAt: Date } | null;
}

/**
 * Aggregate stats for the `/sync` list header.
 */
export async function getSyncListStats(): Promise<SyncListStats> {
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [{ runs24h }] = await db
    .select({ runs24h: count() })
    .from(syncRuns)
    .where(gte(syncRuns.startedAt, dayAgo));

  const [weekly] = await db
    .select({
      total: count(),
      completed: sql<
        number
      >`COUNT(*) FILTER (WHERE ${syncRuns.status} = 'completed')`,
      avgDurationSec: sql<
        number
      >`COALESCE(AVG(EXTRACT(EPOCH FROM (${syncRuns.completedAt} - ${syncRuns.startedAt}))) FILTER (WHERE ${syncRuns.completedAt} IS NOT NULL), 0)`,
    })
    .from(syncRuns)
    .where(gte(syncRuns.startedAt, weekAgo));

  const [last] = await db
    .select({ status: syncRuns.status, startedAt: syncRuns.startedAt })
    .from(syncRuns)
    .orderBy(desc(syncRuns.startedAt))
    .limit(1);

  const totalWeekly = Number(weekly?.total ?? 0);
  const completedWeekly = Number(weekly?.completed ?? 0);
  const successRate7d = totalWeekly === 0
    ? 0
    : (completedWeekly / totalWeekly) * 100;
  const avgDurationSec7d = Number(weekly?.avgDurationSec ?? 0);

  return {
    runs24h: Number(runs24h ?? 0),
    successRate7d,
    avgDurationSec7d,
    lastRun: last ?? null,
  };
}

/**
 * Get a single sync run by ID
 */
export async function getSyncRunById(id: number): Promise<SyncRun | null> {
  logger.debug("SyncDB", "Fetching sync run by ID", { id });

  const [run] = await db
    .select()
    .from(syncRuns)
    .where(eq(syncRuns.id, id))
    .limit(1);

  return run || null;
}

/**
 * Get logs for a sync run, optionally filtered by segment
 */
export async function getSyncRunLogs(
  syncRunId: number,
  segment?: string,
): Promise<SyncRunLog[]> {
  logger.debug("SyncDB", "Fetching sync run logs", { syncRunId, segment });

  let query = db
    .select()
    .from(syncRunLogs)
    .where(eq(syncRunLogs.syncRunId, syncRunId))
    .orderBy(syncRunLogs.createdAt);

  if (segment) {
    query = db
      .select()
      .from(syncRunLogs)
      .where(
        and(
          eq(syncRunLogs.syncRunId, syncRunId),
          eq(syncRunLogs.segment, segment),
        ),
      )
      .orderBy(syncRunLogs.createdAt);
  }

  const logs = await query;

  logger.debug("SyncDB", "Sync run logs fetched", { count: logs.length });

  return logs;
}

/**
 * Get sync run with all its logs
 */
export async function getSyncRunWithLogs(
  id: number,
): Promise<{ run: SyncRun; logs: SyncRunLog[] } | null> {
  const run = await getSyncRunById(id);
  if (!run) return null;

  const logs = await getSyncRunLogs(id);

  return { run, logs };
}

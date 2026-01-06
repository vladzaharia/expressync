import { db } from "../db/index.ts";
import {
  type NewSyncedTransactionEvent,
  type NewSyncRun,
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
import { count, desc, eq, inArray } from "drizzle-orm";
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
  logger.debug("SyncDB", "Checking for running sync");

  const [runningSync] = await db
    .select({ id: syncRuns.id })
    .from(syncRuns)
    .where(eq(syncRuns.status, "running"))
    .limit(1);

  if (runningSync) {
    logger.debug("SyncDB", "Found running sync", { syncRunId: runningSync.id });
  } else {
    logger.debug("SyncDB", "No running sync found");
  }

  return runningSync || null;
}

interface TagSyncStats {
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
 * Create a synced transaction event record
 */
export async function createSyncedEvent(
  data: NewSyncedTransactionEvent,
): Promise<void> {
  await db.insert(syncedTransactionEvents).values(data);
}

/**
 * Batch create synced transaction events
 */
export async function batchCreateSyncedEvents(
  events: NewSyncedTransactionEvent[],
): Promise<void> {
  if (events.length === 0) {
    logger.debug("SyncDB", "No synced events to create");
    return;
  }

  logger.debug("SyncDB", "Creating batch of synced events", {
    count: events.length,
  });

  await db.insert(syncedTransactionEvents).values(events);

  logger.debug("SyncDB", "Synced events created", { count: events.length });
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
 * Get recent sync runs with pagination
 */
export async function getSyncRuns(
  limit: number = 20,
  offset: number = 0,
): Promise<SyncRun[]> {
  logger.debug("SyncDB", "Fetching sync runs", { limit, offset });

  const runs = await db
    .select()
    .from(syncRuns)
    .orderBy(desc(syncRuns.startedAt))
    .limit(limit)
    .offset(offset);

  logger.debug("SyncDB", "Sync runs fetched", { count: runs.length });

  return runs;
}

/**
 * Get total count of sync runs
 */
export async function getSyncRunsCount(): Promise<number> {
  const [{ value }] = await db
    .select({ value: count() })
    .from(syncRuns);
  return value;
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
      .where(eq(syncRunLogs.syncRunId, syncRunId))
      .where(eq(syncRunLogs.segment, segment))
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

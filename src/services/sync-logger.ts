import { db } from "../db/index.ts";
import {
  type NewSyncRunLog,
  type SyncLogLevel,
  syncRunLogs,
  syncRuns,
  type SyncSegment,
  type SyncSegmentStatus,
} from "../db/schema.ts";
import { eq } from "drizzle-orm";
import { logger } from "../lib/utils/logger.ts";

/**
 * SyncLogger - Handles detailed logging for sync run segments
 *
 * Each sync run has multiple segments (tag_linking, transaction_sync).
 * This class provides methods to log messages within each segment
 * and update segment status.
 */
export class SyncLogger {
  private syncRunId: number;
  private currentSegment: SyncSegment | null = null;
  private segmentLogs: Map<SyncSegment, NewSyncRunLog[]> = new Map();
  private segmentHasError: Map<SyncSegment, boolean> = new Map();
  private segmentHasWarning: Map<SyncSegment, boolean> = new Map();

  constructor(syncRunId: number) {
    this.syncRunId = syncRunId;
  }

  /**
   * Start a new segment
   */
  startSegment(segment: SyncSegment): void {
    this.currentSegment = segment;
    this.segmentLogs.set(segment, []);
    this.segmentHasError.set(segment, false);
    this.segmentHasWarning.set(segment, false);
    this.info(`Starting ${segment.replace("_", " ")} segment`);
  }

  /**
   * Log an info message
   */
  info(message: string, context?: Record<string, unknown>): void {
    this.log("info", message, context);
  }

  /**
   * Log a warning message
   */
  warn(message: string, context?: Record<string, unknown>): void {
    if (this.currentSegment) {
      this.segmentHasWarning.set(this.currentSegment, true);
    }
    this.log("warn", message, context);
  }

  /**
   * Log an error message
   */
  error(message: string, context?: Record<string, unknown>): void {
    if (this.currentSegment) {
      this.segmentHasError.set(this.currentSegment, true);
    }
    this.log("error", message, context);
  }

  /**
   * Log a debug message
   */
  debug(message: string, context?: Record<string, unknown>): void {
    this.log("debug", message, context);
  }

  /**
   * Internal log method
   */
  private log(
    level: SyncLogLevel,
    message: string,
    context?: Record<string, unknown>,
  ): void {
    if (!this.currentSegment) {
      logger.warn("SyncLogger", "No segment started, logging to console only", {
        message,
      });
      return;
    }

    const logEntry: NewSyncRunLog = {
      syncRunId: this.syncRunId,
      segment: this.currentSegment,
      level,
      message,
      context: context ? JSON.stringify(context) : null,
    };

    // Add to in-memory buffer
    const logs = this.segmentLogs.get(this.currentSegment) || [];
    logs.push(logEntry);
    this.segmentLogs.set(this.currentSegment, logs);

    // Also log to console
    const logFn = level === "error"
      ? logger.error
      : level === "warn"
      ? logger.warn
      : logger.debug;
    logFn.call(logger, `Sync:${this.currentSegment}`, message, context);
  }

  /**
   * End the current segment and persist logs
   */
  async endSegment(status?: SyncSegmentStatus): Promise<void> {
    if (!this.currentSegment) return;

    const segment = this.currentSegment;
    const logs = this.segmentLogs.get(segment) || [];

    // Determine status if not provided
    let finalStatus: SyncSegmentStatus = status || "success";
    if (!status) {
      if (this.segmentHasError.get(segment)) {
        finalStatus = "error";
      } else if (this.segmentHasWarning.get(segment)) {
        finalStatus = "warning";
      }
    }

    this.info(`Completed ${segment.replace("_", " ")} segment`, {
      status: finalStatus,
    });

    // Persist logs to database
    if (logs.length > 0) {
      await db.insert(syncRunLogs).values(logs);
    }

    // Update segment status on sync run. Only tag_linking and transaction_sync
    // have first-class status columns on sync_runs; scheduling-segment logs are
    // persisted but don't update a segment column on the parent row.
    const statusField = segment === "tag_linking"
      ? "tagLinkingStatus"
      : segment === "transaction_sync"
      ? "transactionSyncStatus"
      : null;
    if (statusField) {
      await db
        .update(syncRuns)
        .set({ [statusField]: finalStatus })
        .where(eq(syncRuns.id, this.syncRunId));
    }

    this.currentSegment = null;
  }

  /**
   * Log a scheduler tier transition.
   *
   * Emits an INFO-level log on the "scheduling" segment. Safe to call outside
   * a started segment: it opens+closes the segment so the log is persisted
   * even when invoked standalone from the scheduler evaluation path.
   */
  async logTierTransition(
    from: string,
    to: string,
    reason: string,
    nextRunAt: Date | null,
  ): Promise<void> {
    const wasInSegment = this.currentSegment !== null;
    const previousSegment = this.currentSegment;

    if (!wasInSegment) {
      this.startSegment("scheduling");
    } else if (this.currentSegment !== "scheduling") {
      // Already inside another segment; briefly switch contexts.
      this.currentSegment = "scheduling";
      if (!this.segmentLogs.has("scheduling")) {
        this.segmentLogs.set("scheduling", []);
        this.segmentHasError.set("scheduling", false);
        this.segmentHasWarning.set("scheduling", false);
      }
    }

    this.info(`Tier transition: ${from} -> ${to}`, {
      from,
      to,
      reason,
      nextRunAt: nextRunAt ? nextRunAt.toISOString() : null,
    });

    if (!wasInSegment) {
      await this.endSegment();
    } else if (previousSegment !== "scheduling") {
      // Flush the scheduling log buffer we just filled, then restore previous.
      const logs = this.segmentLogs.get("scheduling") || [];
      if (logs.length > 0) {
        await db.insert(syncRunLogs).values(logs);
        this.segmentLogs.set("scheduling", []);
      }
      this.currentSegment = previousSegment;
    }
  }

  /**
   * Skip a segment (mark as skipped without running)
   */
  async skipSegment(segment: SyncSegment, reason: string): Promise<void> {
    this.startSegment(segment);
    this.info(`Skipping segment: ${reason}`);
    await this.endSegment("skipped");
  }
}

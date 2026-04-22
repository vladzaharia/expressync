/**
 * SyncScheduler - Adaptive sync cadence (Phase C)
 *
 * Runs the sync handler on an adaptive cron schedule based on observed
 * activity:
 *
 *   - Active   (any inTransaction tag OR any open tx):   every 15 minutes
 *   - Idle     (no active tx; some tx/tag activity in 30d): every hour
 *   - Dormant  (no tx and no tag change for 30d+):         Sundays 03:00 UTC
 *
 * Hysteresis: the tier can only demote after N consecutive "idle"
 * evaluations (SYNC_IDLE_HYSTERESIS_TICKS, default 2), to avoid thrash.
 *
 * Any activity (new transaction, tag change, manual trigger) bumps the tier
 * straight to Active and reschedules at the 15-minute cadence.
 *
 * Admin pin: setting `pinned_tier` + `pinned_until` on sync_schedule_state
 * overrides the computed tier until `pinned_until` elapses.
 *
 * All time math is done in the database (`now()`) rather than `Date.now()`
 * to avoid clock-skew between worker and DB.
 */

import { Cron } from "croner";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/index.ts";
import {
  syncRunLogs,
  syncScheduleState,
  type SyncTier,
  tagChangeLog,
} from "../db/schema.ts";
import { config } from "../lib/config.ts";
import { logger } from "../lib/utils/logger.ts";
import { steveClient } from "../lib/steve-client.ts";
import type { SyncResult } from "./sync.service.ts";

const SINGLETON_ID = 1;

// Cron patterns for each tier.
const TIER_PATTERNS: Record<SyncTier, string> = {
  active: "*/15 * * * *",
  idle: "0 * * * *",
  dormant: "0 3 * * 0",
};

// Human-friendly labels for tiers used in log messages + UI tooltips.
export const TIER_LABELS: Record<SyncTier, string> = {
  active: "Active (every 15 min)",
  idle: "Idle (hourly)",
  dormant: "Dormant (Sundays 03:00 UTC)",
};

export interface SchedulerEvaluationResult {
  previousTier: SyncTier;
  newTier: SyncTier;
  reason: string;
  pattern: string;
  nextRunAt: Date | null;
  pinned: boolean;
}

type SyncHandler = () => Promise<SyncResult | void>;

/**
 * Module-level Cron job handle. We rebuild the Cron on every reschedule
 * rather than relying on runtime pattern mutation.
 */
let job: Cron | null = null;

function patternFor(tier: SyncTier): string {
  // Escape-hatch: if SYNC_CRON_SCHEDULE is set, use it for all tiers.
  if (config.SYNC_CRON_SCHEDULE && config.SYNC_CRON_SCHEDULE.trim()) {
    return config.SYNC_CRON_SCHEDULE.trim();
  }
  return TIER_PATTERNS[tier];
}

function isValidTier(value: string | null | undefined): value is SyncTier {
  return value === "active" || value === "idle" || value === "dormant";
}

class SyncSchedulerImpl {
  private handler: SyncHandler | null = null;
  private cachedTier: SyncTier = "idle";
  private cachedNextRunAt: Date | null = null;
  private running = false;

  /**
   * Start the scheduler. Reads current state from `sync_schedule_state`;
   * if the next run is already overdue, runs the handler immediately and
   * then reschedules. Otherwise simply schedules the next run.
   */
  async start(handler: SyncHandler): Promise<void> {
    this.handler = handler;

    const state = await this.loadOrInitState();
    this.cachedTier = this.effectiveTier(state);
    this.cachedNextRunAt = state.nextRunAt;

    logger.info("SyncScheduler", "Scheduler starting", {
      currentTier: this.cachedTier,
      nextRunAt: state.nextRunAt?.toISOString() ?? null,
      pinnedTier: state.pinnedTier,
      pinnedUntil: state.pinnedUntil?.toISOString() ?? null,
    });

    // Boot-time overdue check: ask the DB whether next_run_at < now().
    // We do the comparison in the DB to avoid worker/DB clock skew.
    const overdue = state.nextRunAt
      ? await this.isOverdueInDb(state.nextRunAt)
      : false;

    if (overdue) {
      logger.info(
        "SyncScheduler",
        "Next run is overdue on boot; running handler immediately",
        { nextRunAt: state.nextRunAt?.toISOString() ?? null },
      );
      // Install the cron for the current tier first, then fire a one-shot
      // immediate run. evaluateAndReschedule (called by the worker after the
      // run completes) will then re-pick the tier.
      this.scheduleCron(this.cachedTier);
      this.runHandlerSafe().catch((err) => {
        logger.error(
          "SyncScheduler",
          "Overdue boot-run failed",
          err as Error,
        );
      });
    } else {
      this.scheduleCron(this.cachedTier);
    }
  }

  /**
   * Stop the active Cron (used by the worker during graceful shutdown).
   */
  stop(): void {
    if (job) {
      job.stop();
      job = null;
    }
    this.handler = null;
  }

  /**
   * Record that activity was observed (manual trigger, tag change, etc.).
   * Bumps tier to "active", stamps last_activity_at = now(), reschedules.
   */
  async onActivityDetected(reason: string): Promise<void> {
    const previousTier = this.cachedTier;

    await db.update(syncScheduleState).set({
      currentTier: "active",
      lastActivityAt: sql`now()`,
      lastEvaluatedAt: sql`now()`,
      consecutiveIdleTicks: 0,
      nextRunAt: sql`now() + interval '15 minutes'`,
    }).where(eq(syncScheduleState.id, SINGLETON_ID));

    const state = await this.loadState();
    if (state) {
      this.cachedTier = this.effectiveTier(state);
      this.cachedNextRunAt = state.nextRunAt;
    } else {
      this.cachedTier = "active";
    }

    logger.info("SyncScheduler", "Activity detected; bumping to Active", {
      reason,
      previousTier,
      newTier: this.cachedTier,
      nextRunAt: this.cachedNextRunAt?.toISOString() ?? null,
    });

    this.scheduleCron(this.cachedTier);
  }

  /**
   * Post-sync evaluation: given the completed sync result, re-derive the
   * correct tier (with hysteresis) and reschedule.
   *
   * Passing syncRunId enables the tier transition to be logged to
   * sync_run_logs with segment='scheduling'.
   */
  async evaluateAndReschedule(
    result?: SyncResult | void,
  ): Promise<SchedulerEvaluationResult> {
    const state = await this.loadOrInitState();
    const previousTier = this.effectiveTier(state);

    // Honor admin pin (if still active) without re-evaluating.
    const pinActive = await this.isPinActive();
    if (pinActive && isValidTier(state.pinnedTier)) {
      const pinnedTier = state.pinnedTier;
      const pattern = patternFor(pinnedTier);
      const nextRunAt = this.computeNextRun(pinnedTier);

      await db.update(syncScheduleState).set({
        currentTier: pinnedTier,
        lastEvaluatedAt: sql`now()`,
        nextRunAt,
      }).where(eq(syncScheduleState.id, SINGLETON_ID));

      this.cachedTier = pinnedTier;
      this.cachedNextRunAt = nextRunAt;
      this.scheduleCron(pinnedTier);

      const evaluation: SchedulerEvaluationResult = {
        previousTier,
        newTier: pinnedTier,
        reason: "admin pin",
        pattern,
        nextRunAt,
        pinned: true,
      };
      await this.logTransitionIfChanged(evaluation, result);
      return evaluation;
    }

    // Probe activity signals.
    const isActive = await this.hasActiveSignal();
    const hasRecentActivity = await this.hasRecentActivity();

    let targetTier: SyncTier;
    let reason: string;
    if (isActive) {
      targetTier = "active";
      reason = "active tx or in-transaction tag";
    } else if (hasRecentActivity) {
      targetTier = "idle";
      reason =
        `tag/tx activity within last ${config.SYNC_DORMANT_THRESHOLD_DAYS}d`;
    } else {
      targetTier = "dormant";
      reason =
        `no tx and no tag changes for ${config.SYNC_DORMANT_THRESHOLD_DAYS}d+`;
    }

    // Apply hysteresis for demotion (active -> idle or idle -> dormant).
    const demoting = this.isDemotion(previousTier, targetTier);
    const currentTicks = state.consecutiveIdleTicks;
    const hysteresisTicks = config.SYNC_IDLE_HYSTERESIS_TICKS;

    let newTier: SyncTier;
    let newTicks: number;

    if (demoting) {
      const willReach = currentTicks + 1;
      if (willReach >= hysteresisTicks) {
        newTier = targetTier;
        newTicks = 0;
      } else {
        newTier = previousTier;
        newTicks = willReach;
        reason =
          `${reason} (holding ${previousTier}, tick ${willReach}/${hysteresisTicks})`;
      }
    } else {
      newTier = targetTier;
      newTicks = 0;
    }

    const pattern = patternFor(newTier);
    const nextRunAt = this.computeNextRun(newTier);

    if (isActive) {
      await db.update(syncScheduleState).set({
        currentTier: newTier,
        lastEvaluatedAt: sql`now()`,
        lastActivityAt: sql`now()`,
        consecutiveIdleTicks: newTicks,
        nextRunAt,
      }).where(eq(syncScheduleState.id, SINGLETON_ID));
    } else {
      await db.update(syncScheduleState).set({
        currentTier: newTier,
        lastEvaluatedAt: sql`now()`,
        consecutiveIdleTicks: newTicks,
        nextRunAt,
      }).where(eq(syncScheduleState.id, SINGLETON_ID));
    }

    this.cachedTier = newTier;
    this.cachedNextRunAt = nextRunAt;
    this.scheduleCron(newTier);

    const evaluation: SchedulerEvaluationResult = {
      previousTier,
      newTier,
      reason,
      pattern,
      nextRunAt,
      pinned: false,
    };
    await this.logTransitionIfChanged(evaluation, result);
    return evaluation;
  }

  currentTier(): SyncTier {
    return this.cachedTier;
  }

  nextRunAt(): Date | null {
    return this.cachedNextRunAt;
  }

  /**
   * Clear the admin pin, if any. (Does not re-evaluate; caller should run
   * evaluateAndReschedule() afterwards if they want immediate re-picking.)
   */
  async clearPin(): Promise<void> {
    await db.update(syncScheduleState).set({
      pinnedTier: null,
      pinnedUntil: null,
    }).where(eq(syncScheduleState.id, SINGLETON_ID));
  }

  /**
   * Set an admin pin: forces the given tier until (now + hours).
   */
  async setPin(tier: SyncTier, hours: number): Promise<void> {
    const clampedHours = Math.max(1, Math.min(24 * 14, Math.floor(hours)));
    await db.update(syncScheduleState).set({
      pinnedTier: tier,
      pinnedUntil: sql`now() + (${clampedHours}::int || ' hours')::interval`,
    }).where(eq(syncScheduleState.id, SINGLETON_ID));
  }

  /**
   * Install a new Cron with the pattern corresponding to `tier`. Stops the
   * previous Cron first; `protect: true` + timezone UTC match the prior
   * sync-worker behavior.
   */
  private scheduleCron(tier: SyncTier): void {
    if (!this.handler) return;
    if (job) {
      job.stop();
      job = null;
    }

    const pattern = patternFor(tier);
    job = new Cron(pattern, { protect: true, timezone: "UTC" }, () => {
      this.runHandlerSafe().catch((err) => {
        logger.error(
          "SyncScheduler",
          "Handler threw",
          err as Error,
        );
      });
    });

    logger.info("SyncScheduler", "Cron rescheduled", {
      tier,
      pattern,
      nextRun: job.nextRun()?.toISOString() ?? null,
    });
  }

  private async runHandlerSafe(): Promise<void> {
    if (!this.handler) return;
    if (this.running) {
      logger.warn(
        "SyncScheduler",
        "Handler already running; skipping this tick",
      );
      return;
    }
    this.running = true;
    try {
      await this.handler();
    } finally {
      this.running = false;
    }
  }

  private async loadState() {
    const [row] = await db.select().from(syncScheduleState).where(
      eq(syncScheduleState.id, SINGLETON_ID),
    ).limit(1);
    return row;
  }

  private async loadOrInitState() {
    const existing = await this.loadState();
    if (existing) return existing;

    await db.insert(syncScheduleState).values({
      id: SINGLETON_ID,
      currentTier: "idle",
      consecutiveIdleTicks: 0,
    }).onConflictDoNothing();

    const [row] = await db.select().from(syncScheduleState).where(
      eq(syncScheduleState.id, SINGLETON_ID),
    ).limit(1);
    if (!row) {
      throw new Error(
        "Failed to load or initialize sync_schedule_state singleton",
      );
    }
    return row;
  }

  /**
   * Resolve the "effective" tier for the given state:
   * - If the admin pin is still active, returns the pinned tier.
   * - Otherwise, returns the stored current_tier.
   */
  private effectiveTier(state: {
    currentTier: string;
    pinnedTier: string | null;
    pinnedUntil: Date | null;
  }): SyncTier {
    const now = Date.now();
    if (
      state.pinnedUntil &&
      state.pinnedUntil.getTime() > now &&
      isValidTier(state.pinnedTier)
    ) {
      return state.pinnedTier;
    }
    return isValidTier(state.currentTier) ? state.currentTier : "idle";
  }

  private isDemotion(from: SyncTier, to: SyncTier): boolean {
    const rank: Record<SyncTier, number> = {
      active: 0,
      idle: 1,
      dormant: 2,
    };
    return rank[to] > rank[from];
  }

  /**
   * Is there any current signal that charging is happening right now?
   * - any tag with inTransaction === true, OR
   * - any transaction with stopTimestamp === null (ACTIVE)
   */
  private async hasActiveSignal(): Promise<boolean> {
    try {
      const activeTxs = await steveClient.getTransactions({ type: "ACTIVE" });
      if (activeTxs.some((tx) => tx.stopTimestamp === null)) return true;
    } catch (err) {
      logger.warn(
        "SyncScheduler",
        "Failed to probe ACTIVE transactions",
        { error: err instanceof Error ? err.message : String(err) },
      );
    }

    try {
      const tags = await steveClient.getOcppTags();
      if (tags.some((t) => t.inTransaction === true)) return true;
    } catch (err) {
      logger.warn(
        "SyncScheduler",
        "Failed to probe OCPP tags for inTransaction",
        { error: err instanceof Error ? err.message : String(err) },
      );
    }

    return false;
  }

  /**
   * Has any tag_change_log entry been detected in the last N days (default 30)?
   * All time math is in DB now() to avoid clock skew.
   */
  private async hasRecentActivity(): Promise<boolean> {
    const days = config.SYNC_DORMANT_THRESHOLD_DAYS;
    const rows = await db.select({ id: tagChangeLog.id })
      .from(tagChangeLog)
      .where(
        sql`${tagChangeLog.detectedAt} > now() - (${days}::int || ' days')::interval`,
      )
      .limit(1);
    return rows.length > 0;
  }

  private async isPinActive(): Promise<boolean> {
    const rows = await db.select({ id: syncScheduleState.id })
      .from(syncScheduleState)
      .where(
        sql`${syncScheduleState.id} = ${SINGLETON_ID}
            AND ${syncScheduleState.pinnedUntil} IS NOT NULL
            AND ${syncScheduleState.pinnedUntil} > now()`,
      )
      .limit(1);
    return rows.length > 0;
  }

  private async isOverdueInDb(nextRunAt: Date): Promise<boolean> {
    // Compare the passed-in timestamp against DB now() so worker/DB clock
    // skew doesn't cause spurious overdue runs. Anchor the predicate on the
    // singleton row (guaranteed to exist after loadOrInitState).
    const rows = await db.select({ id: syncScheduleState.id })
      .from(syncScheduleState)
      .where(
        sql`${syncScheduleState.id} = ${SINGLETON_ID}
            AND (${nextRunAt.toISOString()}::timestamptz) < now()`,
      )
      .limit(1);
    return rows.length > 0;
  }

  /**
   * Compute the next scheduled run using a fresh Cron instance (pattern-only).
   * We still store the resulting timestamp in the DB column so the UI can
   * render a live countdown without going through croner on every request.
   */
  private computeNextRun(tier: SyncTier): Date | null {
    const pattern = patternFor(tier);
    try {
      const transient = new Cron(pattern, { timezone: "UTC" });
      const next = transient.nextRun();
      transient.stop();
      return next;
    } catch (err) {
      logger.error(
        "SyncScheduler",
        "Failed to compute next run",
        { pattern, error: err instanceof Error ? err.message : String(err) },
      );
      return null;
    }
  }

  private async logTransitionIfChanged(
    evaluation: SchedulerEvaluationResult,
    result: SyncResult | void,
  ): Promise<void> {
    const syncRunId = result && typeof result === "object" &&
        "syncRunId" in result
      ? result.syncRunId
      : null;

    const context = {
      from: evaluation.previousTier,
      to: evaluation.newTier,
      reason: evaluation.reason,
      pattern: evaluation.pattern,
      nextRunAt: evaluation.nextRunAt?.toISOString() ?? null,
      pinned: evaluation.pinned,
    };

    logger.info(
      "SyncScheduler",
      evaluation.previousTier === evaluation.newTier
        ? "Tier unchanged after evaluation"
        : "Tier transition",
      context,
    );

    if (syncRunId && syncRunId > 0) {
      try {
        await db.insert(syncRunLogs).values({
          syncRunId,
          segment: "scheduling",
          level: "info",
          message: evaluation.previousTier === evaluation.newTier
            ? `Cadence re-evaluated: staying on ${evaluation.newTier}`
            : `Tier transition: ${evaluation.previousTier} -> ${evaluation.newTier}`,
          context: JSON.stringify(context),
        });
      } catch (err) {
        logger.warn(
          "SyncScheduler",
          "Failed to persist scheduling log",
          { error: err instanceof Error ? err.message : String(err) },
        );
      }
    }
  }
}

// Singleton instance used by the worker + API routes.
export const SyncScheduler = new SyncSchedulerImpl();

// Re-export the handler type for consumers.
export type { SyncHandler };

/**
 * Incremental billing emitter (Wave R — real-time metering).
 *
 * Buffers per-transaction kWh deltas as they arrive from the StEvE
 * MeterValues webhook, flushes them to Lago every ~60 seconds, and
 * publishes a `transaction.billing` SSE event so the customer card can
 * show "billed" cost separate from the locally-estimated cost.
 *
 * Why not flush per-tick: meter samples land every ~15s. Per-event POSTs
 * would burn ~7 req/s of Lago API quota at fleet scale and inflate the
 * `synced_transaction_events` audit table by ~4×. 60s windows are the
 * sweet spot per Lago's metering guidance.
 *
 * Sources of truth:
 *   • `transaction_sync_state.totalKwhBilled` — kWh already pushed to Lago.
 *   • `transaction_sync_state.lastSyncedMeterValue` — Wh meter value at the
 *     last successful flush (also serves as the baseline for the next delta).
 *   • In-memory `state` map — the per-tx scratchpad for queued deltas.
 *
 * Recovery:
 *   • Process restart loses the in-memory queue, but `transaction_sync_state`
 *     persists what was already billed. The post-tx sync sweep ("reconciliation")
 *     compares StEvE's final `stopValue` against `totalKwhBilled` and emits a
 *     single true-up event for the gap. Lossless billing despite emitter crashes.
 *
 * Idempotency:
 *   • Every Lago event uses `lagoEventTransactionId = "steve_tx_<id>_<unix-seconds>"`,
 *     unique per session × second. Lago dedups on the (transaction_id, timestamp)
 *     pair, and our `synced_transaction_events.lagoEventTransactionId` UNIQUE
 *     constraint blocks local re-inserts.
 *   • The reconciliation true-up uses `steve_tx_<id>_final` so it's distinct
 *     from any incremental flush.
 */

import { eq, sql } from "drizzle-orm";
import { db } from "../db/index.ts";
import * as schema from "../db/schema.ts";
import { config } from "../lib/config.ts";
import { lagoClient } from "../lib/lago-client.ts";
import { steveClient } from "../lib/steve-client.ts";
import { logger } from "../lib/utils/logger.ts";
import { eventBus } from "./event-bus.service.ts";
import {
  LAGO_METRIC_ALIAS_KEY,
  LAGO_METRIC_FIELD_NAME,
} from "./lago-event-builder.ts";
import {
  resolveSubscription,
  type SubscriptionResolutionCache,
} from "./mapping-resolver.ts";
import type { LagoEvent } from "../lib/types/lago.ts";

const log = logger.child("IncrementalBilling");

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Maximum dwell-time for an unflushed sample before a forced flush. */
const FLUSH_INTERVAL_MS = 60_000;

/** When this much pending kWh has accumulated, flush early. */
const FLUSH_KWH_THRESHOLD = 1.0;

/** Background sweep frequency — finds stale buffers + retries failures. */
const SWEEP_INTERVAL_MS = 15_000;

/** How long to retain a per-tx state with no new samples before evicting. */
const STATE_TTL_MS = 30 * 60_000; // 30 minutes

/** Memory cap on concurrent tracked transactions. */
const STATE_CAP = 5_000;

/**
 * Plan codes for which incremental events are NOT emitted (flat-rate
 * memberships). Mirror of `transaction-processor.ts#NON_USAGE_PLAN_CODES`.
 */
const NON_USAGE_PLAN_CODES = new Set<string>(["ExpressChargeM"]);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface TxBillingState {
  steveTransactionId: number;
  chargeBoxId: string;
  /** Wh — the StEvE meterValueFrom at session start (set lazily on first sample). */
  startMeterValueWh: number | null;
  /** Wh — last reported meter value from the charger. Monotonic. */
  lastMeterValueWh: number | null;
  /** Wh — meter value at the most recent successful Lago flush. */
  lastBilledMeterValueWh: number;
  /** kWh — running total successfully sent to Lago for this session. */
  totalBilledKwh: number;
  /** kWh — accumulated since the last flush, awaiting send. */
  pendingDeltaKwh: number;
  /** epoch ms — last meter sample we accepted. */
  lastSampleAt: number;
  /** epoch ms — last successful Lago flush (or 0 if none yet). */
  lastFlushAt: number;
  /** True once we know the user-mapping (resolved lazily). */
  resolved: boolean;
  userMappingId: number | null;
  lagoCustomerExternalId: string | null;
  lagoSubscriptionExternalId: string | null;
  /** Plan code; if it matches NON_USAGE_PLAN_CODES, we never flush. */
  planCode: string | null;
  /** Set true when a flush is in flight (prevents concurrent flushes per tx). */
  flushing: boolean;
  /** True when we've published a "ended" billing event. */
  endedEmitted: boolean;
}

const state = new Map<number, TxBillingState>();
const subscriptionCache: SubscriptionResolutionCache = new Map();

let sweepTimer: number | null = null;
let started = false;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface MeterSample {
  steveTransactionId: number;
  chargeBoxId: string;
  /** Total kWh as reported by the charger (cumulative session energy). */
  kwh: number | null;
  /** ISO-8601 timestamp from the charger sample, or null if missing. */
  meterTimestamp: string | null;
  /** True for the final stop-of-transaction sample. Forces an immediate flush. */
  isFinal: boolean;
  /** Pre-resolved by the receiver when available — we cache it but re-resolve on miss. */
  userMappingId?: number | null;
}

/**
 * Receive a meter sample. Idempotent for repeated values; safe to call from
 * multiple concurrent webhook deliveries.
 */
export function enqueueMeterSample(sample: MeterSample): void {
  if (typeof sample.kwh !== "number" || !Number.isFinite(sample.kwh)) return;

  startBackgroundSweepIfNeeded();

  const meterValueWh = Math.round(sample.kwh * 1000);
  const now = Date.now();
  let st = state.get(sample.steveTransactionId);
  if (!st) {
    st = createState(sample, meterValueWh, now);
    rememberState(sample.steveTransactionId, st);
  }

  // Monotonic guard — drop out-of-order or rolled-back samples.
  if (
    st.lastMeterValueWh !== null && meterValueWh < st.lastMeterValueWh - 50
  ) {
    log.warn("Dropping non-monotonic meter sample", {
      transactionId: sample.steveTransactionId,
      previous: st.lastMeterValueWh,
      received: meterValueWh,
    });
    return;
  }

  // First sample for this tx — anchor the start meter value but bill nothing yet.
  if (st.lastMeterValueWh === null) {
    st.lastMeterValueWh = meterValueWh;
    if (st.startMeterValueWh === null) st.startMeterValueWh = meterValueWh;
    if (st.lastBilledMeterValueWh === 0) {
      st.lastBilledMeterValueWh = meterValueWh;
    }
    st.lastSampleAt = now;
    return;
  }

  const deltaWh = meterValueWh - st.lastMeterValueWh;
  if (deltaWh > 0) {
    st.pendingDeltaKwh += deltaWh / 1000;
  }
  st.lastMeterValueWh = meterValueWh;
  st.lastSampleAt = now;
  if (
    sample.userMappingId !== undefined && sample.userMappingId !== null &&
    st.userMappingId === null
  ) {
    st.userMappingId = sample.userMappingId;
  }

  const dueByTime = (now - st.lastFlushAt) >= FLUSH_INTERVAL_MS;
  const dueByVolume = st.pendingDeltaKwh >= FLUSH_KWH_THRESHOLD;
  if (sample.isFinal || dueByTime || dueByVolume) {
    void flush(st, { final: sample.isFinal, reconciliation: false });
  }
}

/**
 * Post-transaction reconciliation pass. Called by sync.service after StEvE
 * confirms a transaction is complete and we know the authoritative
 * `stopValue`. If incremental events under-billed (which is normal — we
 * miss the very first kWh before the receiver caught up), this emits one
 * final "true-up" event and finalizes the sync state.
 *
 * Idempotent: if `totalKwhBilled` already matches the expected total, we
 * record an empty finalization without sending a duplicate event.
 */
export async function reconcileTransaction(args: {
  steveTransactionId: number;
  chargeBoxId: string;
  startMeterValueWh: number;
  stopMeterValueWh: number;
  stopTimestamp: string | null;
  userMappingId: number | null;
  lagoCustomerExternalId: string | null;
  lagoSubscriptionExternalId: string | null;
  planCode: string | null;
  syncRunId: number | null;
}): Promise<{ emittedDeltaKwh: number; alreadyBilledKwh: number }> {
  const expectedKwh = (args.stopMeterValueWh - args.startMeterValueWh) / 1000;

  // Best-effort flush of any in-memory pending samples first.
  const st = state.get(args.steveTransactionId);
  if (st && st.pendingDeltaKwh > 0) {
    await flush(st, { final: true, reconciliation: false });
  }

  // Read the persisted billed total.
  const [persisted] = await db
    .select({
      totalKwhBilled: schema.transactionSyncState.totalKwhBilled,
    })
    .from(schema.transactionSyncState)
    .where(
      eq(
        schema.transactionSyncState.steveTransactionId,
        args.steveTransactionId,
      ),
    )
    .limit(1);

  const alreadyBilledKwh = persisted ? Number(persisted.totalKwhBilled) : 0;
  const gapKwh = round6(expectedKwh - alreadyBilledKwh);

  if (gapKwh <= 0) {
    state.delete(args.steveTransactionId);
    return { emittedDeltaKwh: 0, alreadyBilledKwh };
  }

  // Skip when the customer has no chargeable subscription (mirrors the
  // existing transaction-processor's NON_USAGE_PLAN_CODES + no-subscription
  // skips). The sync.service still records sync state — this function just
  // returns the gap so the caller can log it.
  const skipBilling = !args.lagoSubscriptionExternalId ||
    (args.planCode != null && NON_USAGE_PLAN_CODES.has(args.planCode));

  if (skipBilling) {
    log.info("Reconciliation: skipping Lago event (no subscription / non-usage)", {
      transactionId: args.steveTransactionId,
      gapKwh,
    });
    state.delete(args.steveTransactionId);
    return { emittedDeltaKwh: 0, alreadyBilledKwh };
  }

  const lagoEventTransactionId = `steve_tx_${args.steveTransactionId}_final`;
  const event = buildEvent({
    transactionId: lagoEventTransactionId,
    subscriptionId: args.lagoSubscriptionExternalId!,
    chargeBoxId: args.chargeBoxId,
    kwh: gapKwh,
    timestamp: args.stopTimestamp,
  });

  try {
    await lagoClient.createBatchEvents([event]);
  } catch (err) {
    log.error("Reconciliation Lago push failed; sync run will retry next cycle", {
      transactionId: args.steveTransactionId,
      gapKwh,
      error: err instanceof Error ? err.message : String(err),
    });
    return { emittedDeltaKwh: 0, alreadyBilledKwh };
  }

  const newTotal = round6(alreadyBilledKwh + gapKwh);
  await persistFlush({
    steveTransactionId: args.steveTransactionId,
    lastSyncedMeterValueWh: args.stopMeterValueWh,
    totalBilledKwh: newTotal,
    finalized: true,
    syncRunId: args.syncRunId,
    eventRow: {
      lagoEventTransactionId,
      userMappingId: args.userMappingId,
      kwhDelta: gapKwh,
      meterValueFromWh: Math.round(alreadyBilledKwh * 1000) +
        args.startMeterValueWh,
      meterValueToWh: args.stopMeterValueWh,
      isFinal: true,
      syncRunId: args.syncRunId,
    },
  });

  publishBillingEvent({
    transactionId: args.steveTransactionId,
    billedKwh: newTotal,
    flushedAt: new Date().toISOString(),
    lagoEventTransactionId,
    isReconciliation: true,
    userMappingId: args.userMappingId ?? undefined,
  });

  state.delete(args.steveTransactionId);
  return { emittedDeltaKwh: gapKwh, alreadyBilledKwh };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function createState(
  sample: MeterSample,
  meterValueWh: number,
  now: number,
): TxBillingState {
  return {
    steveTransactionId: sample.steveTransactionId,
    chargeBoxId: sample.chargeBoxId,
    startMeterValueWh: null,
    lastMeterValueWh: null,
    lastBilledMeterValueWh: 0,
    totalBilledKwh: 0,
    pendingDeltaKwh: 0,
    lastSampleAt: now,
    lastFlushAt: 0,
    resolved: false,
    userMappingId: sample.userMappingId ?? null,
    lagoCustomerExternalId: null,
    lagoSubscriptionExternalId: null,
    planCode: null,
    flushing: false,
    endedEmitted: false,
  };
}

function rememberState(txId: number, st: TxBillingState): void {
  if (state.size >= STATE_CAP) {
    // Evict the oldest by lastSampleAt.
    let oldestId: number | null = null;
    let oldestAt = Number.POSITIVE_INFINITY;
    for (const [id, s] of state) {
      if (s.lastSampleAt < oldestAt) {
        oldestAt = s.lastSampleAt;
        oldestId = id;
      }
    }
    if (oldestId !== null) state.delete(oldestId);
  }
  state.set(txId, st);
}

/**
 * Resolve the user-mapping + subscription for this tx, populating the cached
 * state fields. Looks up the StEvE transaction once for the start meter
 * value (used for the meter-value-from on synced_transaction_events rows).
 *
 * Returns false if we can't bill this tx (no mapping / no subscription /
 * non-usage plan); the caller should drop the pending delta in that case.
 */
async function resolveBillingContext(st: TxBillingState): Promise<boolean> {
  if (st.resolved) return st.lagoSubscriptionExternalId !== null;
  st.resolved = true;
  try {
    let idTag: string | null = null;
    let startValueWh: number | null = null;
    const txs = await steveClient.getTransactions({
      transactionPk: st.steveTransactionId,
    });
    if (txs.length > 0) {
      const tx = txs[0];
      idTag = tx.ocppIdTag ?? null;
      const startVal = parseInt(tx.startValue ?? "", 10);
      if (Number.isFinite(startVal)) startValueWh = startVal;
    }
    if (startValueWh !== null && st.startMeterValueWh === null) {
      st.startMeterValueWh = startValueWh;
    }
    if (!idTag) return false;

    const [mapping] = await db
      .select()
      .from(schema.userMappings)
      .where(eq(schema.userMappings.steveOcppIdTag, idTag))
      .limit(1);
    if (!mapping) return false;
    st.userMappingId = mapping.id;
    st.lagoCustomerExternalId = mapping.lagoCustomerExternalId;
    const resolved = await resolveSubscription(mapping, subscriptionCache);
    if (!resolved) return false;
    st.lagoSubscriptionExternalId = resolved.externalId;
    st.planCode = resolved.planCode;
    if (st.planCode && NON_USAGE_PLAN_CODES.has(st.planCode)) return false;
    return true;
  } catch (err) {
    // Don't poison the cache on transient failures — clear `resolved` so
    // the next sample will retry.
    st.resolved = false;
    log.warn("resolveBillingContext failed", {
      transactionId: st.steveTransactionId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

interface FlushOptions {
  /** True when this flush is for the final stop-of-transaction sample. */
  final: boolean;
  /** True when called from the post-tx reconciliation true-up path. */
  reconciliation: boolean;
}

async function flush(st: TxBillingState, opts: FlushOptions): Promise<void> {
  if (st.flushing) return;
  if (st.pendingDeltaKwh <= 0 && !opts.final) return;
  st.flushing = true;
  try {
    const billable = await resolveBillingContext(st);
    if (!billable || !st.lagoSubscriptionExternalId) {
      // Drop the pending delta to avoid unbounded growth — sync.service
      // will catch the post-tx total either way.
      st.pendingDeltaKwh = 0;
      return;
    }

    const flushKwh = round6(st.pendingDeltaKwh);
    const now = new Date();
    const ts = now.toISOString();
    const txId = `steve_tx_${st.steveTransactionId}_${
      Math.floor(now.getTime() / 1000)
    }`;

    const event = buildEvent({
      transactionId: txId,
      subscriptionId: st.lagoSubscriptionExternalId,
      chargeBoxId: st.chargeBoxId,
      kwh: flushKwh,
      timestamp: ts,
    });

    try {
      await lagoClient.createBatchEvents([event]);
    } catch (err) {
      log.warn("Lago flush failed; will retry on next sample / sweep", {
        transactionId: st.steveTransactionId,
        kwh: flushKwh,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    const newTotal = round6(st.totalBilledKwh + flushKwh);
    const meterValueFromWh = st.lastBilledMeterValueWh > 0
      ? st.lastBilledMeterValueWh
      : (st.startMeterValueWh ?? 0);
    const meterValueToWh = st.lastMeterValueWh ?? 0;

    await persistFlush({
      steveTransactionId: st.steveTransactionId,
      lastSyncedMeterValueWh: meterValueToWh,
      totalBilledKwh: newTotal,
      finalized: opts.final,
      syncRunId: null,
      eventRow: {
        lagoEventTransactionId: txId,
        userMappingId: st.userMappingId,
        kwhDelta: flushKwh,
        meterValueFromWh,
        meterValueToWh,
        isFinal: opts.final,
        syncRunId: null,
      },
    });

    st.totalBilledKwh = newTotal;
    st.lastBilledMeterValueWh = meterValueToWh;
    st.pendingDeltaKwh = 0;
    st.lastFlushAt = now.getTime();
    st.endedEmitted = st.endedEmitted || opts.final;

    publishBillingEvent({
      transactionId: st.steveTransactionId,
      billedKwh: newTotal,
      flushedAt: ts,
      lagoEventTransactionId: txId,
      isReconciliation: opts.reconciliation,
      userMappingId: st.userMappingId ?? undefined,
    });

    if (opts.final) {
      state.delete(st.steveTransactionId);
    }
  } finally {
    st.flushing = false;
  }
}

function buildEvent(args: {
  transactionId: string;
  subscriptionId: string;
  chargeBoxId: string;
  kwh: number;
  timestamp: string | null;
}): LagoEvent {
  const kwhStr = args.kwh.toFixed(3);
  const tsSeconds = args.timestamp
    ? Math.floor(new Date(args.timestamp).getTime() / 1000)
    : Math.floor(Date.now() / 1000);
  return {
    transaction_id: args.transactionId,
    external_subscription_id: args.subscriptionId,
    code: config.LAGO_METRIC_CODE,
    timestamp: tsSeconds,
    properties: {
      [LAGO_METRIC_FIELD_NAME]: kwhStr,
      [LAGO_METRIC_ALIAS_KEY]: kwhStr,
      charger_id: args.chargeBoxId,
    },
  };
}

interface FlushPersistArgs {
  steveTransactionId: number;
  lastSyncedMeterValueWh: number;
  totalBilledKwh: number;
  finalized: boolean;
  syncRunId: number | null;
  eventRow: {
    lagoEventTransactionId: string;
    userMappingId: number | null;
    kwhDelta: number;
    meterValueFromWh: number;
    meterValueToWh: number;
    isFinal: boolean;
    syncRunId: number | null;
  };
}

/**
 * Atomically upsert the running sync state and append the audit event row.
 * Conflicts on `lagoEventTransactionId` (UNIQUE) silently no-op so retries
 * after a partial flush don't double-record.
 */
async function persistFlush(args: FlushPersistArgs): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(schema.transactionSyncState)
      .values({
        steveTransactionId: args.steveTransactionId,
        lastSyncedMeterValue: args.lastSyncedMeterValueWh,
        totalKwhBilled: args.totalBilledKwh.toFixed(6),
        lastSyncRunId: args.syncRunId,
        isFinalized: args.finalized,
      })
      .onConflictDoUpdate({
        target: schema.transactionSyncState.steveTransactionId,
        set: {
          lastSyncedMeterValue: args.lastSyncedMeterValueWh,
          totalKwhBilled: args.totalBilledKwh.toFixed(6),
          lastSyncRunId: args.syncRunId,
          isFinalized: args.finalized,
          updatedAt: new Date(),
        },
      });

    await tx
      .insert(schema.syncedTransactionEvents)
      .values({
        steveTransactionId: args.steveTransactionId,
        lagoEventTransactionId: args.eventRow.lagoEventTransactionId,
        userMappingId: args.eventRow.userMappingId ?? null,
        kwhDelta: args.eventRow.kwhDelta.toFixed(6),
        meterValueFrom: args.eventRow.meterValueFromWh,
        meterValueTo: args.eventRow.meterValueToWh,
        isFinal: args.eventRow.isFinal,
        syncRunId: args.eventRow.syncRunId,
      })
      .onConflictDoNothing({
        target: schema.syncedTransactionEvents.lagoEventTransactionId,
      });
  });
}

function publishBillingEvent(payload: {
  transactionId: number;
  billedKwh: number;
  billedCostCents?: number;
  flushedAt: string;
  lagoEventTransactionId: string;
  isReconciliation: boolean;
  userMappingId?: number;
}): void {
  try {
    eventBus.publish({
      type: "transaction.billing",
      payload,
    });
  } catch (err) {
    log.warn("eventBus.publish(transaction.billing) failed", {
      transactionId: payload.transactionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// Background sweep — flushes idle buffers + evicts stale state
// ---------------------------------------------------------------------------

function startBackgroundSweepIfNeeded(): void {
  if (started) return;
  started = true;
  sweepTimer = setInterval(sweep, SWEEP_INTERVAL_MS) as unknown as number;
}

/** Public for tests/shutdown. */
export function shutdownIncrementalBilling(): void {
  if (sweepTimer !== null) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
  started = false;
  state.clear();
  subscriptionCache.clear();
}

async function sweep(): Promise<void> {
  const now = Date.now();
  const work: Promise<void>[] = [];
  for (const [id, st] of state) {
    if (now - st.lastSampleAt > STATE_TTL_MS) {
      // No samples in a long time — let the post-tx reconciliation handle it.
      state.delete(id);
      continue;
    }
    if (st.pendingDeltaKwh > 0 && now - st.lastFlushAt >= FLUSH_INTERVAL_MS) {
      work.push(flush(st, { final: false, reconciliation: false }));
    }
  }
  if (work.length > 0) {
    try {
      await Promise.allSettled(work);
    } catch (err) {
      log.warn("Sweep flush batch threw", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** Test/observability hook — snapshot of internal state for assertions. */
export const _internal = {
  state,
  subscriptionCache,
  flushImmediately: flush,
  resolveBillingContext,
};

// Suppress unused warning for `sql` (kept for future LISTEN-aware sweep).
void sql;

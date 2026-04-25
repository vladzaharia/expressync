/**
 * Pair-intent watchdog (fallback RemoteStop).
 *
 * The pre-authorize hook in the SteVe fork is the primary defense against
 * a scan-to-login intercept starting a real charging session. But there
 * are a handful of ways the hook can miss:
 *
 *   - Hook timed out (SteVe's 200ms budget was exceeded).
 *   - Charger had LocalPreAuthorize / AuthorizationCache enabled and
 *     skipped the CS on this tag.
 *   - SteVe fork is not yet deployed on one of the chargers in the fleet.
 *
 * When that happens the charger sends StartTransaction.req, SteVe accepts,
 * transaction begins — and the customer sees no login. The watchdog
 * closes this gap:
 *
 *   1. Subscribe to `tx.started` events (published by
 *      docker-log-subscriber when it parses a StartTransaction log line).
 *   2. For each event, check whether an armed-OR-just-matched scan-pair
 *      row exists for the chargeBoxId. If yes:
 *      a. Issue RemoteStopTransaction via steveClient.
 *      b. Record a charger_operation_log row with reason
 *         "intercepted-for-login" for audit.
 *   3. Do NOT consume the verification row here — the real scan-login
 *      flow may still succeed in parallel; let it be the single
 *      consumer.
 *
 * Idempotency: repeated tx.started events for the same transactionId are
 * tracked in an in-memory recent-set so we don't fire RemoteStop twice.
 *
 * Fail-open: any DB / steveClient error is logged, not thrown. The
 * watchdog never blocks event dispatch.
 */

import { sql } from "drizzle-orm";
import { db } from "../db/index.ts";
import { chargerOperationLog } from "../db/schema.ts";
import { eventBus } from "./event-bus.service.ts";
import { subscribe as subscribeDockerLogs } from "./docker-log-subscriber.ts";
import { steveClient } from "../lib/steve-client.ts";
import { FEATURE_PAIR_INTENT_INTERCEPT } from "../lib/feature-flags.ts";
import { logger } from "../lib/utils/logger.ts";

const log = logger.child("PairIntentWatchdog");

/**
 * Time window during which a tx.started event counts as "during an armed
 * intent". The verification row's own expires_at is the source of truth;
 * this is just a sanity bound that prevents a stale match row from
 * triggering a RemoteStop minutes later.
 */
const MATCH_WINDOW_MS = 10_000;

/** Recent transactionIds we've already stopped (or attempted to). */
const recentlyStopped = new Set<number>();
const RECENT_TTL_MS = 60_000;

function markRecent(txId: number): void {
  recentlyStopped.add(txId);
  setTimeout(() => recentlyStopped.delete(txId), RECENT_TTL_MS);
}

let started = false;
let unsubEventBus: (() => void) | null = null;
let unsubDocker: (() => void) | null = null;

export function startPairIntentWatchdog(): void {
  if (started) return;
  if (!FEATURE_PAIR_INTENT_INTERCEPT) {
    log.info("Feature flag off — not starting watchdog");
    return;
  }
  started = true;

  // Subscribe to the event bus first — this catches tx.started events
  // fanned out via Postgres NOTIFY from other workers (e.g. the worker
  // serving a scan-detect SSE connection that originally parsed the log
  // line).
  unsubEventBus = eventBus.subscribe(["tx.started"], (delivered) => {
    const payload = delivered.payload as {
      chargeBoxId: string;
      transactionId: number | null;
      idTag: string | null;
      t: number;
    };
    void handleTxStarted(payload).catch((err) => {
      log.warn("handleTxStarted threw (event-bus)", {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  });

  // Also keep a standalone docker-log subscription alive so the log
  // stream runs even when no SSE consumer is connected. Without this,
  // the stream would shut down and tx.started events would never fire.
  void subscribeDockerLogs(
    (_event) => {
      // No-op handler — docker-log-subscriber itself publishes tx.started
      // events to the event bus, which our event-bus subscriber above
      // will receive. We only subscribe here to pin the stream open.
    },
    (err) => {
      log.warn("Docker log stream error in watchdog", { error: err.message });
    },
  ).then((sub) => {
    if (sub.available) {
      unsubDocker = sub.unsubscribe;
    } else {
      log.warn("Docker unavailable — watchdog relies on other subscribers");
    }
  });

  log.info("Pair-intent watchdog started");
}

export function stopPairIntentWatchdog(): void {
  if (unsubEventBus) {
    unsubEventBus();
    unsubEventBus = null;
  }
  if (unsubDocker) {
    unsubDocker();
    unsubDocker = null;
  }
  started = false;
}

async function handleTxStarted(payload: {
  chargeBoxId: string;
  transactionId: number | null;
  idTag: string | null;
  t: number;
}): Promise<void> {
  const { chargeBoxId, transactionId, idTag } = payload;

  if (!transactionId) return; // No transactionId → can't RemoteStop.
  if (recentlyStopped.has(transactionId)) return;

  // Only act if an intent was armed or matched for this charger within
  // the match window. Also require the idTag to match when present —
  // never RemoteStop a transaction that wasn't actually the intercepted
  // scan.
  const cutoffIso = new Date(Date.now() - MATCH_WINDOW_MS).toISOString();
  let rows: { id: string; purpose: string | null }[];
  try {
    const result = await db.execute<{ id: string; purpose: string | null }>(sql`
      SELECT
        id,
        value::jsonb->>'purpose' AS purpose
      FROM verifications
      WHERE identifier LIKE ${`scan-pair:${chargeBoxId}:%`}
        AND expires_at > now()
        AND (
          value::jsonb->>'status' = 'armed'
          OR (
            value::jsonb->>'status' IN ('matched', 'consumed')
            AND updated_at > ${cutoffIso}
            AND (${idTag}::text IS NULL
                 OR value::jsonb->>'matchedIdTag' = ${idTag}::text)
          )
        )
      LIMIT 1
    `);
    rows = (Array.isArray(result)
      ? result
      : (result as { rows?: unknown[] }).rows ?? []) as {
        id: string;
        purpose: string | null;
      }[];
  } catch (err) {
    log.warn("Failed to check for armed intent", {
      chargeBoxId,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  if (rows.length === 0) return; // No intercept context → leave tx alone.

  markRecent(transactionId);

  log.info("Intercepted transaction slipped past hook — issuing RemoteStop", {
    chargeBoxId,
    transactionId,
    idTag,
    purpose: rows[0].purpose ?? "login",
  });

  let logRowId: number | undefined;
  try {
    const [logRow] = await db.insert(chargerOperationLog).values({
      chargeBoxId,
      operation: "RemoteStopTransaction",
      params: { transactionId, chargeBoxId, reason: "intercepted-for-login" },
      status: "pending",
    }).returning({ id: chargerOperationLog.id });
    logRowId = logRow?.id;
  } catch (err) {
    log.warn("Failed to pre-record RemoteStop operation", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    const result = await steveClient.operations.remoteStop({
      chargeBoxId,
      transactionId,
    });
    if (logRowId !== undefined) {
      await db.update(chargerOperationLog)
        .set({
          status: "submitted",
          result: result as unknown as Record<string, unknown>,
          completedAt: new Date(),
        })
        .where(sql`id = ${logRowId}`);
    }
  } catch (err) {
    log.error("RemoteStop failed for intercepted transaction", {
      chargeBoxId,
      transactionId,
      error: err instanceof Error ? err.message : String(err),
    });
    if (logRowId !== undefined) {
      try {
        await db.update(chargerOperationLog)
          .set({
            status: "failed",
            result: {
              error: err instanceof Error ? err.message : String(err),
            },
            completedAt: new Date(),
          })
          .where(sql`id = ${logRowId}`);
      } catch {
        /* swallow — audit-row update is best-effort. */
      }
    }
  }
}

// Test-only introspection.
export function _isRunningForTests(): boolean {
  return started;
}
export function _clearRecentForTests(): void {
  recentlyStopped.clear();
}

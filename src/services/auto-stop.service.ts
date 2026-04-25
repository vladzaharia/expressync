/**
 * Auto-stop service (Wave R) — sweeps in-flight transactions for a set of
 * user-mapping IDs and issues a RemoteStopTransaction for each one.
 *
 * Triggered by:
 *   • subscription.terminated / subscription.terminated_and_downgraded
 *     webhooks (the customer's plan ended; any in-progress charge would
 *     bill against a deactivated mapping).
 *   • wallet.depleted_ongoing_balance webhook (the customer's prepaid
 *     wallet hit zero — for guest passes / pay-as-you-go plans this is
 *     the hard cap).
 *   • subscription.usage_threshold_reached when the threshold is the
 *     plan's hard cap (operator-configured: an alert metadata flag
 *     `enforce_stop=true`). Otherwise the threshold is informational.
 *
 * Invariants:
 *   • Idempotent — re-firing for the same mapping while the previous
 *     stop is in flight is a no-op (rememberRecent + 60s TTL).
 *   • Best-effort — every step is wrapped in try/catch; failures log
 *     and feed into the admin notification stream but never throw out
 *     to the webhook handler. The next sync sweep is the safety net.
 *   • Audit-first — every stop attempt writes a row to
 *     `charger_operation_log` before the OCPP call so operators can
 *     correlate stops with the originating webhook.
 *
 * Why a separate service instead of inlining into the webhook handler:
 *   • Reusable for non-webhook callers (e.g. operator-triggered "stop
 *     all sessions for this customer" from an admin alert UI).
 *   • Testable in isolation — the webhook handler is a thin dispatcher.
 */

import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.ts";
import * as schema from "../db/schema.ts";
import { steveClient } from "../lib/steve-client.ts";
import { logger } from "../lib/utils/logger.ts";
import { createNotification } from "./notification.service.ts";

const log = logger.child("AutoStop");

const RECENT_TTL_MS = 60_000;
const recentlyStopped = new Map<number, number>();

function markRecent(txId: number): void {
  recentlyStopped.set(txId, Date.now());
  // Periodic GC; cheap because the map rarely exceeds a few dozen entries.
  if (recentlyStopped.size > 256) {
    const cutoff = Date.now() - RECENT_TTL_MS;
    for (const [id, t] of recentlyStopped) {
      if (t < cutoff) recentlyStopped.delete(id);
    }
  }
}

function wasRecentlyStopped(txId: number): boolean {
  const t = recentlyStopped.get(txId);
  if (t === undefined) return false;
  if (Date.now() - t > RECENT_TTL_MS) {
    recentlyStopped.delete(txId);
    return false;
  }
  return true;
}

export interface AutoStopReason {
  /** Short tag for the operation log + notification body. */
  code:
    | "subscription_terminated"
    | "wallet_depleted"
    | "usage_cap_exceeded"
    | "card_reported_lost"
    | "manual";
  /** Long-form for the admin notification body. */
  detail: string;
  /** Originating Lago webhook event row id, if any. */
  webhookEventId?: number;
}

export interface AutoStopResult {
  attempted: number;
  succeeded: number;
  failed: number;
  /** Per-tx outcome detail useful for observability + tests. */
  results: Array<{
    transactionPk: number;
    chargeBoxId: string;
    ok: boolean;
    error?: string;
  }>;
}

/**
 * Stop every in-flight StEvE transaction whose ocppIdTag belongs to
 * one of the supplied user_mappings rows.
 */
export async function stopActiveTransactionsForMappings(
  mappingIds: number[],
  reason: AutoStopReason,
): Promise<AutoStopResult> {
  const result: AutoStopResult = {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    results: [],
  };
  if (mappingIds.length === 0) return result;

  // Resolve idTags from mappings (StEvE keys transactions on idTag, not
  // on user_mappings.id).
  const mappings = await db
    .select({
      id: schema.userMappings.id,
      steveOcppIdTag: schema.userMappings.steveOcppIdTag,
    })
    .from(schema.userMappings)
    .where(inArray(schema.userMappings.id, mappingIds));

  if (mappings.length === 0) return result;

  // Lookup in-flight transactions per idTag. StEvE supports
  // inTransaction=TRUE filtering — one call per idTag is fine; in
  // practice this fans out to ≤ a handful per webhook.
  for (const m of mappings) {
    let activeTxs: Awaited<ReturnType<typeof steveClient.getTransactions>> = [];
    try {
      activeTxs = await steveClient.getTransactions({
        ocppIdTag: m.steveOcppIdTag,
        // StEvE's `type=ACTIVE` returns only in-flight transactions.
        type: "ACTIVE",
      });
    } catch (err) {
      log.warn("getTransactions failed; skipping idTag", {
        idTag: m.steveOcppIdTag,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    for (const tx of activeTxs) {
      if (wasRecentlyStopped(tx.id)) {
        log.debug("Skipping recently-stopped tx", { transactionId: tx.id });
        continue;
      }
      result.attempted += 1;
      const r = await stopOne(tx.id, tx.chargeBoxId, reason);
      result.results.push(r);
      if (r.ok) {
        result.succeeded += 1;
        markRecent(tx.id);
      } else {
        result.failed += 1;
      }
    }
  }

  if (result.attempted > 0) {
    try {
      await createNotification({
        kind: "auto_stop",
        severity: result.failed > 0 ? "warn" : "info",
        title: `Auto-stopped ${result.succeeded}/${result.attempted} session(s)`,
        body:
          `${reason.detail}\n\n${result.succeeded} session(s) stopped, ${result.failed} failed. ` +
          `Source: ${reason.code}.`,
        sourceType: reason.webhookEventId !== undefined
          ? "webhook_event"
          : null,
        sourceId: reason.webhookEventId !== undefined
          ? String(reason.webhookEventId)
          : null,
        adminUserId: null,
      });
    } catch (err) {
      log.warn("Failed to create auto_stop notification", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

/** Single-transaction stop with an audit-log row. */
async function stopOne(
  transactionId: number,
  chargeBoxId: string,
  reason: AutoStopReason,
): Promise<{
  transactionPk: number;
  chargeBoxId: string;
  ok: boolean;
  error?: string;
}> {
  let logRowId: number | undefined;
  try {
    const [logRow] = await db.insert(schema.chargerOperationLog).values({
      chargeBoxId,
      operation: "RemoteStopTransaction",
      params: {
        transactionId,
        chargeBoxId,
        reason: `auto-stop:${reason.code}`,
        detail: reason.detail,
      },
      status: "pending",
    }).returning({ id: schema.chargerOperationLog.id });
    logRowId = logRow?.id;
  } catch (err) {
    log.warn("Failed to pre-record auto-stop operation", {
      transactionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    await steveClient.operations.remoteStop({
      chargeBoxId,
      transactionId,
    });
    if (logRowId !== undefined) {
      try {
        await db
          .update(schema.chargerOperationLog)
          .set({ status: "completed", completedAt: new Date() })
          .where(eq(schema.chargerOperationLog.id, logRowId));
      } catch {
        /* ignore — audit row stays "pending"; a follow-up sync repairs */
      }
    }
    log.info("Auto-stopped transaction", {
      transactionId,
      chargeBoxId,
      reason: reason.code,
    });
    return { transactionPk: transactionId, chargeBoxId, ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("Auto-stop RemoteStop failed", {
      transactionId,
      chargeBoxId,
      error: msg,
    });
    if (logRowId !== undefined) {
      try {
        await db
          .update(schema.chargerOperationLog)
          .set({
            status: "failed",
            completedAt: new Date(),
            result: { error: msg },
          })
          .where(eq(schema.chargerOperationLog.id, logRowId));
      } catch {
        /* ignore */
      }
    }
    return {
      transactionPk: transactionId,
      chargeBoxId,
      ok: false,
      error: msg,
    };
  }
}

/**
 * Stop active transactions for a single Lago subscription. Resolves
 * mapping IDs locally then delegates to `stopActiveTransactionsForMappings`.
 */
export async function stopActiveTransactionsForSubscription(
  externalSubscriptionId: string,
  reason: AutoStopReason,
): Promise<AutoStopResult> {
  const rows = await db
    .select({ id: schema.userMappings.id })
    .from(schema.userMappings)
    .where(
      eq(
        schema.userMappings.lagoSubscriptionExternalId,
        externalSubscriptionId,
      ),
    );
  if (rows.length === 0) return { attempted: 0, succeeded: 0, failed: 0, results: [] };
  return await stopActiveTransactionsForMappings(rows.map((r) => r.id), reason);
}

/**
 * Stop active transactions for an entire Lago customer (by
 * external_customer_id). Used for wallet-depleted webhooks where the
 * cap applies to all of the customer's subscriptions, not just one.
 */
export async function stopActiveTransactionsForCustomer(
  externalCustomerId: string,
  reason: AutoStopReason,
): Promise<AutoStopResult> {
  const rows = await db
    .select({ id: schema.userMappings.id })
    .from(schema.userMappings)
    .where(
      and(
        eq(schema.userMappings.lagoCustomerExternalId, externalCustomerId),
        eq(schema.userMappings.isActive, true),
      ),
    );
  if (rows.length === 0) return { attempted: 0, succeeded: 0, failed: 0, results: [] };
  return await stopActiveTransactionsForMappings(rows.map((r) => r.id), reason);
}

/** Test/observability hook. */
export const _internal = { recentlyStopped, markRecent, wasRecentlyStopped };

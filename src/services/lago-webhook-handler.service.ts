/**
 * Lago Webhook Handler Service
 *
 * Two-phase webhook processing for Phase D:
 *
 *   1. `persistWebhookEvent(body)` — INSERT the raw payload into
 *      `lago_webhook_events` FIRST, before any parsing. This is append-only
 *      so we never lose data even if dispatch throws. Returns the row id.
 *
 *   2. `dispatch(body, rowId)` — parse with the discriminated-union schema
 *      and run per-type reactions. MVP reactions exist for:
 *        - `alert.triggered`
 *        - `invoice.created` / `invoice.drafted` / `invoice.generated`
 *        - `invoice.payment_status_updated` (when payment_status === "failed")
 *        - `wallet_transaction.payment_failure`
 *      Each reaction calls `notify()` which — as of Phase P1 — inserts a row
 *      into the `notifications` table (via `createNotification`) in addition
 *      to emitting the stable `ADMIN_ALERT` log line so log aggregators keep
 *      working.
 *
 * A module-level circuit breaker disables dispatch after N consecutive
 * dispatch failures. The counter resets on the first success after cooldown.
 * While disabled, `persistWebhookEvent` still runs so we keep an audit trail
 * and can replay from fixtures later via `scripts/replay-lago-webhook.ts`.
 */

import { eq } from "drizzle-orm";
import { db } from "../db/index.ts";
import { lagoWebhookEvents, type NewLagoWebhookEvent } from "../db/schema.ts";
import {
  type LagoWebhook,
  type LagoWebhookEnvelope,
  LagoWebhookEnvelopeSchema,
  LagoWebhookSchema,
} from "../lib/types/lago.ts";
import { logger } from "../lib/utils/logger.ts";
import {
  createNotification,
  type CreateNotificationInput,
  type NotificationSourceType,
} from "./notification.service.ts";

const log = logger.child("LagoWebhookHandler");

// ----------------------------------------------------------------------------
// Notification bridge — keeps the `ADMIN_ALERT` log line (for aggregators) +
// inserts a row into the notifications table so the header bell + archive UI
// surface the event.
// ----------------------------------------------------------------------------

export type NotificationSeverity = "info" | "success" | "warn" | "error";

export interface AdminNotification {
  kind: string;
  severity: NotificationSeverity;
  title: string;
  body: string;
  context?: Record<string, unknown>;
  /** Originating entity type (drives the outlined source chip + click URL). */
  sourceType?: NotificationSourceType | null;
  /** Originating entity id (string form). */
  sourceId?: string | null;
}

/**
 * Emit an admin notification. Logs `ADMIN_ALERT` (category preserved for
 * existing log aggregators) AND inserts a row into `notifications` via
 * `createNotification`. The insert is fire-and-forget so a notification-store
 * outage never destabilises the webhook pipeline — `createNotification` itself
 * swallows insert errors and logs them.
 *
 * Accepts the broader `AdminNotification` shape so new callers (including
 * P0's circuit-breaker recovery) can drop through without a schema change.
 */
export function notify(n: AdminNotification): void {
  log.warn("ADMIN_ALERT", {
    kind: n.kind,
    severity: n.severity,
    title: n.title,
    body: n.body,
    sourceType: n.sourceType ?? undefined,
    sourceId: n.sourceId ?? undefined,
    ...(n.context ?? {}),
  });

  // Map the wider severity set to the notifications table's enum — the
  // constraint only allows info|success|warn|error, which matches today.
  const payload: CreateNotificationInput = {
    kind: n.kind,
    severity: n.severity,
    title: n.title,
    body: n.body,
    sourceType: n.sourceType ?? null,
    sourceId: n.sourceId ?? null,
    context: n.context ?? null,
  };

  // Fire and forget: errors are logged inside createNotification.
  void createNotification(payload);
}

// ----------------------------------------------------------------------------
// Circuit breaker state (module-level, process-local).
// ----------------------------------------------------------------------------

const CIRCUIT_BREAKER_THRESHOLD = 5;
/** After this many consecutive failures, dispatch is disabled until cooldown. */
const CIRCUIT_BREAKER_COOLDOWN_MS = 5 * 60_000; // 5 minutes

let consecutiveFailures = 0;
let disabledUntilMs: number | null = null;

function isDispatchDisabled(): boolean {
  if (disabledUntilMs === null) return false;
  if (Date.now() >= disabledUntilMs) {
    // cooldown elapsed — allow one attempt; counter resets on success
    disabledUntilMs = null;
    return false;
  }
  return true;
}

function recordDispatchSuccess(): void {
  // The breaker is considered "open" when either the cooldown window is still
  // active OR the failure counter reached the threshold at any point. Note
  // `isDispatchDisabled()` clears `disabledUntilMs` when the cooldown elapses
  // and lets one attempt through — so by the time we land here, the flag may
  // already be null even though the breaker was tripped. Using the threshold
  // comparison gives us a stable "was tripped" signal.
  const wasDisabled = disabledUntilMs !== null ||
    consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD;
  const previousFailures = consecutiveFailures;
  if (consecutiveFailures > 0) {
    log.info("Dispatch recovered; circuit-breaker counter reset", {
      previousFailures,
    });
  }
  consecutiveFailures = 0;
  disabledUntilMs = null;
  if (wasDisabled) {
    notify({
      kind: "lago_webhook_recovered",
      severity: "info",
      title: "Lago webhook dispatch resumed",
      body:
        `Dispatch recovered after ${previousFailures} consecutive failures.`,
      sourceType: "system",
      sourceId: "lago-webhook-dispatch",
      context: { previousFailures },
    });
  }
}

function recordDispatchFailure(err: unknown): void {
  consecutiveFailures += 1;
  log.warn("Dispatch failure recorded", {
    consecutiveFailures,
    threshold: CIRCUIT_BREAKER_THRESHOLD,
    error: err instanceof Error ? err.message : String(err),
  });
  if (
    consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD &&
    disabledUntilMs === null
  ) {
    disabledUntilMs = Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS;
    notify({
      kind: "lago_webhook_dispatch_disabled",
      severity: "error",
      title: "Lago webhook dispatch disabled",
      body:
        `Dispatch failed ${consecutiveFailures} times in a row. Audit-only mode until ${
          new Date(disabledUntilMs).toISOString()
        }.`,
      sourceType: "system",
      sourceId: "lago-webhook-dispatch",
      context: { consecutiveFailures },
    });
  }
}

/** Test-only accessor for the breaker state. */
export function _getCircuitBreakerState(): {
  consecutiveFailures: number;
  disabledUntilMs: number | null;
} {
  return { consecutiveFailures, disabledUntilMs };
}

/** Test-only reset. */
export function _resetCircuitBreaker(): void {
  consecutiveFailures = 0;
  disabledUntilMs = null;
}

// ----------------------------------------------------------------------------
// Phase P4: public circuit-breaker controls (used by /api/admin/webhook-events)
// ----------------------------------------------------------------------------

/**
 * Public view of the circuit-breaker state. Shape intended for the admin
 * audit UI; callers receive a derived `open` flag plus the raw counters so
 * they can render a countdown.
 */
export interface CircuitBreakerSnapshot {
  open: boolean;
  consecutiveFailures: number;
  threshold: number;
  disabledUntilMs: number | null;
  cooldownMs: number;
}

export function getCircuitBreakerState(): CircuitBreakerSnapshot {
  const now = Date.now();
  const open = disabledUntilMs !== null && now < disabledUntilMs;
  return {
    open,
    consecutiveFailures,
    threshold: CIRCUIT_BREAKER_THRESHOLD,
    disabledUntilMs,
    cooldownMs: CIRCUIT_BREAKER_COOLDOWN_MS,
  };
}

/**
 * Admin-triggered reset. Clears both the failure counter and the cooldown
 * flag. Distinct from `recordDispatchSuccess()` in that it does not emit a
 * `lago_webhook_recovered` notification — the admin already knows.
 */
export function resetCircuitBreaker(): void {
  const previousFailures = consecutiveFailures;
  consecutiveFailures = 0;
  disabledUntilMs = null;
  log.info("Circuit breaker reset by admin", { previousFailures });
}

// ----------------------------------------------------------------------------
// Persistence (append-only audit)
// ----------------------------------------------------------------------------

/**
 * Best-effort extraction of identifiers for indexing. Lago puts the object
 * under a key matching `object_type` (e.g. `invoice`, `alert`,
 * `wallet_transaction`). We only ever READ these — they don't gate anything.
 */
function extractIdentifiers(body: unknown): {
  objectType: string | null;
  lagoObjectId: string | null;
  externalCustomerId: string | null;
  externalSubscriptionId: string | null;
} {
  const b = (body ?? {}) as Record<string, unknown>;
  const objectType = typeof b.object_type === "string" ? b.object_type : null;

  // The object itself is typically nested under `object_type` OR one of a
  // handful of known keys.
  const candidateKeys = [
    objectType,
    "invoice",
    "customer",
    "subscription",
    "wallet",
    "wallet_transaction",
    "alert",
    "credit_note",
    "payment",
    "payment_request",
    "fee",
    "event",
  ].filter((k): k is string => typeof k === "string" && k in b);

  let inner: Record<string, unknown> | null = null;
  for (const key of candidateKeys) {
    const v = b[key];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      inner = v as Record<string, unknown>;
      break;
    }
  }

  const pickStr = (
    obj: Record<string, unknown> | null,
    key: string,
  ): string | null => {
    if (!obj) return null;
    const v = obj[key];
    return typeof v === "string" ? v : null;
  };

  const lagoObjectId = pickStr(inner, "lago_id");

  // external_customer_id may live on the inner object or on a nested customer.
  let externalCustomerId = pickStr(inner, "external_customer_id");
  if (!externalCustomerId && inner && typeof inner.customer === "object") {
    externalCustomerId = pickStr(
      inner.customer as Record<string, unknown>,
      "external_id",
    );
  }

  // external_subscription_id may live on inner or inside subscriptions[0].
  let externalSubscriptionId = pickStr(inner, "external_subscription_id") ??
    pickStr(inner, "subscription_external_id");
  if (
    !externalSubscriptionId && inner && Array.isArray(inner.subscriptions) &&
    inner.subscriptions.length > 0 &&
    typeof inner.subscriptions[0] === "object" && inner.subscriptions[0]
  ) {
    externalSubscriptionId = pickStr(
      inner.subscriptions[0] as Record<string, unknown>,
      "external_id",
    );
  }

  return {
    objectType,
    lagoObjectId,
    externalCustomerId,
    externalSubscriptionId,
  };
}

/**
 * Persist the raw webhook payload to `lago_webhook_events`. This runs
 * unconditionally (even if dispatch is disabled) so the audit table is
 * always complete and we can replay later.
 *
 * @returns row id (number)
 */
export async function persistWebhookEvent(body: unknown): Promise<number> {
  const webhookType = typeof (body as { webhook_type?: unknown })
      ?.webhook_type === "string"
    ? ((body as { webhook_type: string }).webhook_type)
    : "unknown";

  const ids = extractIdentifiers(body);

  const row: NewLagoWebhookEvent = {
    webhookType,
    objectType: ids.objectType,
    lagoObjectId: ids.lagoObjectId,
    externalCustomerId: ids.externalCustomerId,
    externalSubscriptionId: ids.externalSubscriptionId,
    rawPayload: (body ?? {}) as NewLagoWebhookEvent["rawPayload"],
  };

  const [inserted] = await db
    .insert(lagoWebhookEvents)
    .values(row)
    .returning({ id: lagoWebhookEvents.id });

  log.debug("Webhook persisted", {
    id: inserted.id,
    webhookType,
    objectType: ids.objectType,
  });

  return inserted.id;
}

// ----------------------------------------------------------------------------
// Dispatch
// ----------------------------------------------------------------------------

/**
 * Parse + react to a webhook. Updates `processed_at` and (on error)
 * `processing_error` on the previously-persisted row.
 *
 * Never throws — caller wraps this in a try/catch but we also defensively
 * record the error and return so the HTTP handler can always reply 200.
 */
export async function dispatch(
  body: unknown,
  rowId: number,
): Promise<void> {
  if (isDispatchDisabled()) {
    log.warn("Dispatch skipped (circuit breaker open)", { rowId });
    await markProcessed(rowId, "circuit_breaker_open");
    return;
  }

  const startedAt = Date.now();
  try {
    const parsed = LagoWebhookSchema.safeParse(body);

    let notificationFired = false;

    if (parsed.success) {
      notificationFired = reactTo(parsed.data, rowId);
    } else {
      // Unknown or malformed payload — log, but keep the audit row.
      const envelope = LagoWebhookEnvelopeSchema.safeParse(body);
      if (envelope.success) {
        log.info("Unhandled webhook type (envelope parse OK)", {
          webhookType: envelope.data.webhook_type,
          rowId,
        });
      } else {
        log.warn("Webhook failed envelope parse", {
          rowId,
          error: envelope.error.message,
        });
      }
    }

    await markProcessed(rowId, null, notificationFired);
    recordDispatchSuccess();
    log.debug("Dispatch complete", {
      rowId,
      ms: Date.now() - startedAt,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("Dispatch threw", { rowId, error: msg });
    await markProcessed(rowId, msg);
    recordDispatchFailure(err);
  }
}

async function markProcessed(
  rowId: number,
  processingError: string | null = null,
  notificationFired: boolean = false,
): Promise<void> {
  try {
    await db.update(lagoWebhookEvents).set({
      processedAt: new Date(),
      processingError,
      notificationFired,
    }).where(eq(lagoWebhookEvents.id, rowId));
  } catch (err) {
    // Don't propagate — we're already in an error path; just log.
    log.error("Failed to mark webhook row as processed", {
      rowId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Run per-type reactions. Returns true if a notification was fired.
 *
 * Each reaction supplies `sourceType` + `sourceId` so the resulting
 * notification row deep-links to the right surface (invoice detail, webhook
 * audit, Lago dashboard, etc.) via `resolveSourceUrl`.
 */
function reactTo(payload: LagoWebhook, rowId: number): boolean {
  // `webhook_event` is the universal fallback source: every reaction has a
  // persisted webhook row it originated from, so even if a more specific
  // deep-link isn't possible, the notification can still reach `/admin/
  // webhook-events/{rowId}`. Individual cases override when they have a
  // better target.
  const webhookSource: Pick<AdminNotification, "sourceType" | "sourceId"> = {
    sourceType: "webhook_event",
    sourceId: String(rowId),
  };

  switch (payload.webhook_type) {
    case "alert.triggered": {
      const alert = payload.alert;
      notify({
        kind: "lago_alert_triggered",
        severity: "warn",
        title: `Lago alert triggered: ${alert.code ?? "unknown"}`,
        body: `Subscription ${
          alert.subscription_external_id ?? "(unknown)"
        } crossed a threshold (current=${alert.current_value ?? "?"}).`,
        sourceType: "alert",
        sourceId: alert.lago_id ?? webhookSource.sourceId,
        context: {
          alertLagoId: alert.lago_id,
          alertCode: alert.code,
          subscription_external_id: alert.subscription_external_id,
          current_value: alert.current_value,
          triggered_at: alert.triggered_at,
          webhookEventId: rowId,
        },
      });
      return true;
    }

    case "invoice.payment_status_updated": {
      const inv = payload.invoice;
      if (inv?.payment_status === "failed") {
        notify({
          kind: "lago_invoice_payment_failed",
          severity: "warn",
          title: `Invoice payment failed: ${inv.number ?? inv.lago_id}`,
          body:
            `Invoice ${inv.lago_id} payment status transitioned to 'failed'.`,
          sourceType: "invoice",
          sourceId: inv.lago_id,
          context: {
            invoice_lago_id: inv.lago_id,
            invoice_number: inv.number,
            total_amount_cents: inv.total_amount_cents,
            currency: inv.currency,
            webhookEventId: rowId,
          },
        });
        return true;
      }
      return false;
    }

    case "invoice.created":
    case "invoice.drafted":
    case "invoice.generated": {
      // Lifecycle signals. `invoice.drafted` and `invoice.created` fire when
      // Lago opens a new invoice (in OSS without grace period these happen
      // back-to-back). `invoice.generated` fires when the PDF finalizes.
      const inv = payload.invoice;
      if (!inv) {
        log.debug("Invoice lifecycle webhook with no payload", {
          webhookType: payload.webhook_type,
        });
        return false;
      }
      notify({
        kind: `lago_${payload.webhook_type.replace(".", "_")}`,
        severity: "info",
        title: `Invoice ${payload.webhook_type.split(".")[1]}: ${
          inv.number ?? inv.lago_id
        }`,
        body: `Invoice ${inv.lago_id} (${
          inv.status ?? "unknown status"
        }) for customer ${inv.customer?.external_id ?? "(unknown)"}.`,
        sourceType: "invoice",
        sourceId: inv.lago_id,
        context: {
          invoice_lago_id: inv.lago_id,
          invoice_number: inv.number,
          status: inv.status,
          payment_status: inv.payment_status,
          invoice_type: inv.invoice_type,
          total_amount_cents: inv.total_amount_cents,
          currency: inv.currency,
          external_customer_id: inv.customer?.external_id,
          webhookEventId: rowId,
        },
      });
      return true;
    }

    case "wallet_transaction.payment_failure": {
      const wt = payload.wallet_transaction;
      notify({
        kind: "lago_wallet_transaction_payment_failure",
        severity: "warn",
        title: "Wallet top-up payment failed",
        body: `Wallet transaction ${
          wt.lago_id ?? "(unknown)"
        } failed for customer ${wt.external_customer_id ?? "(unknown)"}.`,
        sourceType: "wallet_transaction",
        sourceId: wt.lago_id ?? webhookSource.sourceId,
        context: {
          wallet_transaction_lago_id: wt.lago_id,
          wallet_lago_id: wt.lago_wallet_id,
          external_customer_id: wt.external_customer_id,
          amount: wt.amount,
          webhookEventId: rowId,
        },
      });
      return true;
    }

    default:
      // All other known types are currently audit-only.
      log.debug("Audit-only webhook", { webhookType: payload.webhook_type });
      return false;
  }
}

// Re-export envelope type for callers that want to peek at payloads.
export type { LagoWebhook, LagoWebhookEnvelope };

// ----------------------------------------------------------------------------
// Phase P4: replay (used by /api/admin/webhook-events/[id]/replay)
// ----------------------------------------------------------------------------

export interface ReplayResult {
  success: boolean;
  newEventId: number;
  error?: string;
}

/**
 * Replay a previously-persisted webhook event.
 *
 * Inserts a new `lago_webhook_events` row cloned from the source and tagged
 * with `replayed_from_id`, `replayed_at`, and `replayed_by_user_id`, then runs
 * the existing `dispatch()` pipeline against it. Never throws — returns a
 * structured result so the admin UI can batch outcomes.
 *
 * The new row gets its own `received_at` (now); `processed_at` /
 * `processing_error` are populated by `dispatch()` as normal.
 */
export async function replay(
  eventId: number,
  userId: string,
): Promise<ReplayResult> {
  // 1. Fetch the source row.
  let source: typeof lagoWebhookEvents.$inferSelect | undefined;
  try {
    const rows = await db
      .select()
      .from(lagoWebhookEvents)
      .where(eq(lagoWebhookEvents.id, eventId))
      .limit(1);
    source = rows[0];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("Replay: failed to load source row", { eventId, error: msg });
    return { success: false, newEventId: 0, error: `Load failed: ${msg}` };
  }

  if (!source) {
    log.warn("Replay: source row not found", { eventId });
    return {
      success: false,
      newEventId: 0,
      error: `Webhook event ${eventId} not found`,
    };
  }

  // 2. Insert the cloned row.
  let newId: number;
  try {
    const clone: NewLagoWebhookEvent = {
      webhookType: source.webhookType,
      objectType: source.objectType,
      lagoObjectId: source.lagoObjectId,
      externalCustomerId: source.externalCustomerId,
      externalSubscriptionId: source.externalSubscriptionId,
      rawPayload: source.rawPayload,
      replayedFromId: source.id,
      replayedAt: new Date(),
      replayedByUserId: userId,
    };
    const [inserted] = await db
      .insert(lagoWebhookEvents)
      .values(clone)
      .returning({ id: lagoWebhookEvents.id });
    newId = inserted.id;
    log.info("Replay: cloned row inserted", {
      sourceId: eventId,
      newId,
      userId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("Replay: failed to clone row", { eventId, error: msg });
    return { success: false, newEventId: 0, error: `Clone failed: ${msg}` };
  }

  // 3. Dispatch the clone. `dispatch()` already swallows its own errors and
  //    writes `processing_error` on failure — we still check the row state
  //    afterwards so the admin sees replay-level success vs dispatch failure.
  try {
    await dispatch(source.rawPayload, newId);
  } catch (err) {
    // Defensive: dispatch is documented as never-throws, but we guard anyway.
    const msg = err instanceof Error ? err.message : String(err);
    log.error("Replay: dispatch threw (unexpected)", {
      newId,
      error: msg,
    });
    return { success: false, newEventId: newId, error: msg };
  }

  // Look up the dispatch result for the caller.
  try {
    const [after] = await db
      .select({ processingError: lagoWebhookEvents.processingError })
      .from(lagoWebhookEvents)
      .where(eq(lagoWebhookEvents.id, newId))
      .limit(1);
    if (after?.processingError) {
      return {
        success: false,
        newEventId: newId,
        error: after.processingError,
      };
    }
  } catch (err) {
    // Non-fatal: the row exists; we just couldn't read the final status.
    log.warn("Replay: could not read post-dispatch status", {
      newId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { success: true, newEventId: newId };
}

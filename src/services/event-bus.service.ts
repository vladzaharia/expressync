/**
 * Event Bus (Phase P7 — SSE backbone)
 *
 * Tiny in-memory pub/sub for emitting real-time events to SSE consumers.
 * Per-worker and single-process: cross-worker/broker coordination (Redis,
 * Postgres LISTEN/NOTIFY, NATS, etc.) is explicit future work and NOT
 * implemented here. The intent is to get browser clients off polling for
 * the P1 bell + invoice detail surfaces, and reserve a clean seam for the
 * Phase-L charger live-status stream.
 *
 * Design notes:
 *   - Typed event union (`EventBusEvent`) — publishers get autocomplete
 *     on `type`, handlers get narrowed payloads.
 *   - `subscribe(types[], handler)` returns an `unsubscribe()` disposer.
 *   - A bounded ring buffer keeps the last 60 seconds of events so SSE
 *     endpoints can honor `Last-Event-ID` replay on reconnect.
 *   - Monotonic `seq` id per emitted event, used as the SSE `id:` line.
 *   - Handlers are invoked synchronously but each inside its own try/catch
 *     so a misbehaving subscriber can't wedge the publish loop.
 */

import { logger } from "../lib/utils/logger.ts";
import { config } from "../lib/config.ts";
import {
  InMemoryTransport,
  PostgresNotifyTransport,
  type SseTransport,
} from "../lib/sse-transport.ts";
import type {
  DeviceScanCancelledPayload,
  DeviceScanCompletedPayload,
  DeviceScanRequestedPayload,
  DeviceSessionReplacedPayload,
  DeviceTokenRevokedPayload,
  ScanPurpose,
} from "../lib/types/devices.ts";

const log = logger.child("EventBus");

// ---------------------------------------------------------------------------
// Typed events
// ---------------------------------------------------------------------------

export type EventBusEventType =
  | "notification.created"
  | "notification.read"
  | "invoice.updated"
  | "charger.state"
  | "transaction.meter"
  | "transaction.billing"
  | "tag.seen"
  | "scan.intercepted"
  | "tx.started"
  | "sync.completed"
  | "heartbeat"
  // ExpresScan / Wave 1 Track A — device lifecycle events.
  | "device.scan.requested"
  | "device.scan.completed"
  | "device.scan.cancelled"
  | "device.session.replaced"
  | "device.token.revoked";

export interface NotificationCreatedPayload {
  id: number;
  kind: string;
  severity: "info" | "success" | "warn" | "error";
  title: string;
  body: string;
  sourceType: string | null;
  sourceId: string | null;
  sourceUrl: string | null;
  adminUserId: string | null;
  createdAt: string;
}

export interface NotificationReadPayload {
  /** `null` when the action was "mark all read". */
  id: number | null;
  adminUserId: string;
  count?: number;
}

export interface InvoiceUpdatedPayload {
  /** Lago invoice id (uuid-ish string). */
  invoiceId: string;
  status?: string;
  paymentStatus?: string;
  paymentOverdue?: boolean;
  webhookType?: string;
}

export interface ChargerStatePayload {
  chargeBoxId: string;
  status: string;
  connectorId?: number;
  updatedAt: string;
}

export interface TransactionMeterPayload {
  transactionId: number | string;
  chargeBoxId: string;
  /** Cumulative energy delivered this session, in kWh. */
  kwh?: number;
  /** Instantaneous power draw in kW (rolling 60s average if not reported by the charger). */
  powerKw?: number;
  /** OCPP MeterValue timestamp from the charger (ISO-8601). */
  meterTimestamp?: string;
  /** Connector id reported by the charger; useful for chargers with multiple ports. */
  connectorId?: number;
  /**
   * `user_mappings.id` for the customer that owns this transaction. Required
   * for the customer SSE stream to fan out without leaking other customers'
   * meter ticks. Publishers MUST set this when known; absent → customer
   * stream drops the event (fail-closed).
   */
  userMappingId?: number;
  /** Set when the session ends (final MeterValues with stop context). */
  endedAt?: string;
}

/**
 * Emitted by the incremental billing emitter every time it successfully
 * pushes one or more events to Lago for an active transaction. Lets the
 * customer LiveSessionCard show a "billed" running total separate from
 * the locally-estimated cost (kWh × tariff). Convergence between billed
 * and estimated proves Lago accepted the events.
 */
export interface TransactionBillingPayload {
  transactionId: number | string;
  /** Cumulative kWh confirmed by Lago for this session (sum of all sent deltas). */
  billedKwh: number;
  /** Currency-minor-unit cost confirmed by Lago, when known. Optional —
   * Lago resolves the tariff at event ingest, not at our emit time. */
  billedCostCents?: number;
  /** ISO-8601 of the most recent successful flush. */
  flushedAt: string;
  /** Per-event idempotency key of the latest flush — useful for audit log linking. */
  lagoEventTransactionId: string;
  /** True when this is the post-tx reconciliation true-up (final event for the session). */
  isReconciliation: boolean;
  /** When non-null, must match the customer SSE filter — same semantics as TransactionMeterPayload. */
  userMappingId?: number;
}

export interface TagSeenPayload {
  idTag: string;
  chargeBoxId?: string | null;
  seenAt: string;
}

/**
 * Emitted when an armed scan-pair / device-scan row matches an incoming
 * tag scan. Fans out to scan-detect SSE consumers (charger source) and
 * the customer / admin scan-result handlers (device source).
 *
 * Two sources, one event:
 *   - `ocpp-preauth` — `POST /api/ocpp/pre-authorize` matched an armed
 *     `scan-pair:{chargeBoxId}:{pairingCode}` row. `pairableType='charger'`,
 *     `pairableId=chargeBoxId`.
 *   - `device-scan-result` — `POST /api/devices/scan-result` (Track C-result)
 *     matched an armed `device-scan:{deviceId}:{pairingCode}` row.
 *     `pairableType='device'`, `pairableId=deviceId`.
 *
 * Filter on the `(pairableType, pairableId, pairingCode)` triple — the
 * legacy `chargeBoxId` field has been removed (Wave 1 Track A
 * generalization). Consumers are updated in the same commit so the build
 * stays green.
 *
 * Fires uniformly for known AND unknown tags — the hook's job is to
 * stop the charger / surface the scan and hand off the idTag to the
 * waiting flow. Downstream consumers decide what to do based on `purpose`:
 *
 *   - `login`         — scan-login completes (or 401s on unknown idTag).
 *   - `admin-link`    — admin links the tag to a customer.
 *   - `customer-link` — authenticated customer adds another tag.
 *   - `view-card`     — read-only enrichment (no mutation).
 *
 * Unknown `purpose` strings are forwarded as-is for forward-compat.
 */
export interface ScanInterceptedPayload {
  idTag: string;
  /** Discriminator: which kind of pairable matched. */
  pairableType: "charger" | "device";
  /** chargeBoxId when type=charger; deviceId (UUID) when type=device. */
  pairableId: string;
  pairingCode: string;
  /** Intent purpose — defaults to "login" when the intent was armed without one. */
  purpose: ScanPurpose | string;
  /** ms since epoch at the time of match. */
  t: number;
  /** Which producer emitted the event — useful for diagnostics + selective consumers. */
  source: "ocpp-preauth" | "device-scan-result";
}

/**
 * Emitted by docker-log-subscriber when a StartTransaction line is parsed.
 * Consumed by the pair-intent watchdog as the fallback RemoteStop trigger
 * in case the pre-auth hook didn't prevent the transaction (e.g. hook
 * timed out, charger had cached auth).
 */
export interface TxStartedPayload {
  chargeBoxId: string;
  idTag: string | null;
  transactionId: number | null;
  /** ms since epoch. */
  t: number;
}

export interface SyncCompletedPayload {
  syncRunId: number;
  transactionsProcessed: number;
  eventsCreated: number;
  errorCount: number;
}

export type EventBusEvent =
  | { type: "notification.created"; payload: NotificationCreatedPayload }
  | { type: "notification.read"; payload: NotificationReadPayload }
  | { type: "invoice.updated"; payload: InvoiceUpdatedPayload }
  | { type: "charger.state"; payload: ChargerStatePayload }
  | { type: "transaction.meter"; payload: TransactionMeterPayload }
  | { type: "transaction.billing"; payload: TransactionBillingPayload }
  | { type: "tag.seen"; payload: TagSeenPayload }
  | { type: "scan.intercepted"; payload: ScanInterceptedPayload }
  | { type: "tx.started"; payload: TxStartedPayload }
  | { type: "sync.completed"; payload: SyncCompletedPayload }
  | { type: "heartbeat"; payload: { ts: number } }
  // ExpresScan / Wave 1 Track A — device lifecycle events.
  | { type: "device.scan.requested"; payload: DeviceScanRequestedPayload }
  | { type: "device.scan.completed"; payload: DeviceScanCompletedPayload }
  | { type: "device.scan.cancelled"; payload: DeviceScanCancelledPayload }
  | { type: "device.session.replaced"; payload: DeviceSessionReplacedPayload }
  | { type: "device.token.revoked"; payload: DeviceTokenRevokedPayload };

export interface DeliveredEvent {
  seq: number;
  ts: number;
  type: EventBusEventType;
  // deno-lint-ignore no-explicit-any
  payload: any;
  /**
   * Opaque identifier of the worker process that originally published
   * this event. Added by Wave A8 so the Postgres transport can dedupe
   * the NOTIFY echo it receives back on its own LISTEN connection.
   * Optional for backwards compat.
   */
  workerId?: string;
}

/** Unique per-process id tagged onto every event this worker publishes. */
export const WORKER_ID: string = crypto.randomUUID();

export type EventHandler = (event: DeliveredEvent) => void;

interface Subscription {
  types: Set<EventBusEventType> | null; // null = all
  handler: EventHandler;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const BUFFER_WINDOW_MS = 60_000;
/** Hard cap on buffer size even if publish rate spikes. */
const BUFFER_MAX = 2_000;

class EventBus {
  private seq = 0;
  private subs = new Set<Subscription>();
  private buffer: DeliveredEvent[] = [];
  private transport: SseTransport = new InMemoryTransport();
  private transportUnsub: (() => void) | null = null;
  private transportKind: "memory" | "postgres" = "memory";

  constructor() {
    // Default transport handler: fan-out delivered events to local subs.
    // Wired up synchronously; for postgres it's rewired in `setTransport`.
    void this.transport
      .subscribe((ev) => this.onTransportEvent(ev))
      .then((unsub) => {
        this.transportUnsub = unsub;
      });
  }

  private onTransportEvent(ev: DeliveredEvent): void {
    // Postgres echoes our own NOTIFY back — skip to avoid double delivery.
    if (
      this.transportKind === "postgres" &&
      ev.workerId === WORKER_ID
    ) {
      return;
    }
    if (this.transportKind === "postgres") {
      // Cross-worker event: record in local ring buffer so same-worker
      // Last-Event-ID replay keeps working after reconnects.
      this.buffer.push(ev);
      this.trimBuffer();
    }
    this.fanOut(ev);
  }

  /**
   * Swap the underlying transport. Called once at module init based on
   * `SSE_TRANSPORT` config. Idempotent for the same kind.
   */
  async setTransport(
    transport: SseTransport,
    kind: "memory" | "postgres",
  ): Promise<void> {
    if (this.transportUnsub) {
      try {
        this.transportUnsub();
      } catch {
        /* ignore */
      }
      this.transportUnsub = null;
    }
    try {
      await this.transport.close();
    } catch {
      /* ignore */
    }
    this.transport = transport;
    this.transportKind = kind;
    this.transportUnsub = await transport.subscribe((ev) =>
      this.onTransportEvent(ev)
    );
  }

  private fanOut(delivered: DeliveredEvent): void {
    for (const sub of this.subs) {
      if (sub.types !== null && !sub.types.has(delivered.type)) continue;
      try {
        sub.handler(delivered);
      } catch (err) {
        log.warn("Subscriber threw — isolating", {
          type: delivered.type,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  publish<E extends EventBusEvent>(event: E): DeliveredEvent {
    this.seq += 1;
    const delivered: DeliveredEvent = {
      seq: this.seq,
      ts: Date.now(),
      type: event.type,
      payload: event.payload,
      workerId: WORKER_ID,
    };

    // Record in ring buffer first so late subscribers still see history.
    this.buffer.push(delivered);
    this.trimBuffer();

    // Forward to transport for cross-worker broadcast. For postgres the
    // NOTIFY echo is ignored via WORKER_ID dedup in onTransportEvent, so
    // we must also fan-out locally here. For in-memory, the transport
    // handler fans out synchronously — fan-out in publish would double;
    // so we only do the direct fan-out for postgres.
    if (this.transportKind === "postgres") {
      this.fanOut(delivered);
    }

    void this.transport.publish(delivered).catch((err) => {
      log.warn("Transport publish failed", {
        type: event.type,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    return delivered;
  }

  subscribe(
    types: EventBusEventType[] | null,
    handler: EventHandler,
  ): () => void {
    const sub: Subscription = {
      types: types === null ? null : new Set(types),
      handler,
    };
    this.subs.add(sub);
    return () => {
      this.subs.delete(sub);
    };
  }

  /**
   * Return buffered events with seq greater than `afterSeq`, optionally
   * filtered to a set of types. Used by SSE endpoints to replay missed
   * events on `Last-Event-ID` reconnects.
   */
  replay(
    afterSeq: number,
    types?: EventBusEventType[],
  ): DeliveredEvent[] {
    const cutoff = Date.now() - BUFFER_WINDOW_MS;
    const typeSet = types && types.length > 0 ? new Set(types) : null;
    return this.buffer.filter((e) =>
      e.seq > afterSeq &&
      e.ts >= cutoff &&
      (typeSet === null || typeSet.has(e.type))
    );
  }

  /** Current subscriber count — exposed for diagnostics / memory caps. */
  subscriberCount(): number {
    return this.subs.size;
  }

  /** Test hook. */
  _reset(): void {
    this.seq = 0;
    this.subs.clear();
    this.buffer = [];
  }

  /** Test hook. */
  _currentTransportKind(): "memory" | "postgres" {
    return this.transportKind;
  }

  private trimBuffer(): void {
    const cutoff = Date.now() - BUFFER_WINDOW_MS;
    // Drop time-expired events from the head.
    while (this.buffer.length > 0 && this.buffer[0].ts < cutoff) {
      this.buffer.shift();
    }
    // Hard size cap.
    if (this.buffer.length > BUFFER_MAX) {
      this.buffer.splice(0, this.buffer.length - BUFFER_MAX);
    }
  }
}

// Singleton per worker process.
export const eventBus = new EventBus();

// ---------------------------------------------------------------------------
// Transport bootstrap (Wave A8)
// ---------------------------------------------------------------------------

/**
 * Kick off the configured SSE transport. Safe to call at module import:
 * errors are caught so a temporarily-unreachable Postgres doesn't crash
 * the web server — in-memory fallback remains active.
 */
if (config.SSE_TRANSPORT === "postgres") {
  try {
    const pg = new PostgresNotifyTransport(config.DATABASE_URL);
    eventBus
      .setTransport(pg, "postgres")
      .then(() => pg.start())
      .then(() => {
        log.info("SSE transport initialized", { kind: "postgres" });
      })
      .catch((err) => {
        log.error(
          "Failed to initialize Postgres SSE transport; staying on memory",
          { error: err instanceof Error ? err.message : String(err) },
        );
      });
  } catch (err) {
    log.error("Failed to construct Postgres SSE transport", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

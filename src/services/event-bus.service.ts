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
  | "tag.seen"
  | "sync.completed"
  | "heartbeat";

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
  kwh?: number;
  endedAt?: string;
}

export interface TagSeenPayload {
  idTag: string;
  chargeBoxId?: string | null;
  seenAt: string;
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
  | { type: "tag.seen"; payload: TagSeenPayload }
  | { type: "sync.completed"; payload: SyncCompletedPayload }
  | { type: "heartbeat"; payload: { ts: number } };

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

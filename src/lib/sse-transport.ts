/**
 * SSE Transport Abstraction (Wave A8)
 *
 * Pluggable pub/sub transport underneath the event bus. Default is an
 * in-memory fan-out — identical semantics to the previous behavior, so a
 * single-process deployment is unchanged. A Postgres LISTEN/NOTIFY
 * implementation is also exported; flipping `SSE_TRANSPORT=postgres` lets
 * multiple worker processes coordinate SSE events through the database
 * without any extra broker.
 *
 * The event bus keeps its own 60s replay ring buffer; transports are only
 * the cross-worker coordination layer. Last-Event-ID replay still works
 * against the local ring buffer.
 */

import postgres from "postgres";
import type { DeliveredEvent } from "../services/event-bus.service.ts";
import { logger } from "./utils/logger.ts";

const log = logger.child("SseTransport");

/** Postgres NOTIFY payload cap — Postgres itself allows 8000 bytes. */
export const NOTIFY_CHANNEL = "sse_events";
export const NOTIFY_MAX_PAYLOAD_BYTES = 7000;

export type TransportHandler = (event: DeliveredEvent) => void;

export interface SseTransport {
  /** Broadcast an event to every subscriber (possibly cross-process). */
  publish(event: DeliveredEvent): Promise<void>;
  /** Register a handler. Returns an unsubscribe fn. */
  subscribe(handler: TransportHandler): Promise<() => void>;
  /** Release any resources (connections, handlers). */
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// In-memory (default)
// ---------------------------------------------------------------------------

export class InMemoryTransport implements SseTransport {
  private handlers = new Set<TransportHandler>();

  // deno-lint-ignore require-await
  async publish(event: DeliveredEvent): Promise<void> {
    for (const h of this.handlers) {
      try {
        h(event);
      } catch (err) {
        log.warn("InMemoryTransport handler threw", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // deno-lint-ignore require-await
  async subscribe(handler: TransportHandler): Promise<() => void> {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  // deno-lint-ignore require-await
  async close(): Promise<void> {
    this.handlers.clear();
  }
}

// ---------------------------------------------------------------------------
// Postgres LISTEN/NOTIFY
// ---------------------------------------------------------------------------

/**
 * Postgres LISTEN/NOTIFY transport.
 *
 * Channel: `sse_events`. Payload: JSON-serialized DeliveredEvent.
 *
 * Reuses the LISTEN/NOTIFY pattern from `sync-worker.ts` +
 * `sync-notifier.service.ts`: a dedicated postgres client with `max: 1`
 * and `idle_timeout: 0` for the LISTEN side, and a second dedicated
 * client for NOTIFY. On LISTEN close we rebuild the client and retry
 * every 5s, matching the sync worker.
 */
export class PostgresNotifyTransport implements SseTransport {
  private listenClient: ReturnType<typeof postgres> | null = null;
  private notifyClient: ReturnType<typeof postgres> | null = null;
  private handlers = new Set<TransportHandler>();
  private databaseUrl: string;
  private isClosed = false;
  private retryTimer: number | null = null;
  private listenEstablished = false;

  constructor(databaseUrl: string) {
    this.databaseUrl = databaseUrl;
  }

  private createListenClient(): ReturnType<typeof postgres> {
    return postgres(this.databaseUrl, {
      max: 1,
      idle_timeout: 0,
      onclose: () => {
        if (this.isClosed) return;
        log.warn("LISTEN connection closed unexpectedly; reconnecting");
        this.listenEstablished = false;
        this.listenClient = this.createListenClient();
        this.scheduleListen(5000);
      },
    });
  }

  private getNotifyClient(): ReturnType<typeof postgres> {
    if (!this.notifyClient) {
      this.notifyClient = postgres(this.databaseUrl, {
        max: 1,
        idle_timeout: 0,
      });
    }
    return this.notifyClient;
  }

  private scheduleListen(delayMs: number): void {
    if (this.isClosed) return;
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
    }
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.setupListen().catch((err) => {
        log.error("setupListen rejected", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, delayMs) as unknown as number;
  }

  private async setupListen(): Promise<void> {
    if (this.isClosed) return;
    if (!this.listenClient) {
      this.listenClient = this.createListenClient();
    }
    try {
      await this.listenClient.listen(
        NOTIFY_CHANNEL,
        (payload) => this.onNotification(payload),
        () => {
          log.info("LISTEN connection established", {
            channel: NOTIFY_CHANNEL,
          });
        },
      );
      this.listenEstablished = true;
      log.info("LISTEN established", { channel: NOTIFY_CHANNEL });
    } catch (error) {
      log.error("LISTEN failed; retrying in 5s", {
        error: error instanceof Error ? error.message : String(error),
      });
      this.scheduleListen(5000);
    }
  }

  private onNotification(payload: string): void {
    let parsed: DeliveredEvent;
    try {
      parsed = JSON.parse(payload) as DeliveredEvent;
    } catch (err) {
      log.warn("Failed to parse NOTIFY payload", {
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    for (const h of this.handlers) {
      try {
        h(parsed);
      } catch (err) {
        log.warn("PostgresNotifyTransport handler threw", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  /** Public: explicitly start the LISTEN loop. Safe to call multiple times. */
  async start(): Promise<void> {
    if (this.isClosed) return;
    if (this.listenEstablished) return;
    await this.setupListen();
  }

  async publish(event: DeliveredEvent): Promise<void> {
    if (this.isClosed) return;
    const payload = JSON.stringify(event);
    const size = new TextEncoder().encode(payload).byteLength;
    if (size > NOTIFY_MAX_PAYLOAD_BYTES) {
      log.warn("Dropping NOTIFY payload; exceeds size cap", {
        bytes: size,
        cap: NOTIFY_MAX_PAYLOAD_BYTES,
        type: event.type,
        seq: event.seq,
      });
      return;
    }
    try {
      await this.getNotifyClient().notify(NOTIFY_CHANNEL, payload);
    } catch (err) {
      log.error("NOTIFY failed", {
        error: err instanceof Error ? err.message : String(err),
        type: event.type,
      });
    }
  }

  // deno-lint-ignore require-await
  async subscribe(handler: TransportHandler): Promise<() => void> {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  async close(): Promise<void> {
    this.isClosed = true;
    this.handlers.clear();
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    try {
      if (this.listenClient) {
        await this.listenClient.end();
        this.listenClient = null;
      }
    } catch {
      /* ignore */
    }
    try {
      if (this.notifyClient) {
        await this.notifyClient.end();
        this.notifyClient = null;
      }
    } catch {
      /* ignore */
    }
  }
}

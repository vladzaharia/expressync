/**
 * `useInvoiceSse(invoiceId)` — scoped per-invoice SSE hook.
 *
 * Opens a dedicated `EventSource` against `/api/stream/invoices?invoiceId=...`
 * for a single invoice detail view. Lives outside the shared `SseProvider`
 * leader-election model because the stream URL is dynamic (one per invoice
 * id) — the provider's `STREAMS` list assumes a finite, known-at-build-time
 * set of URLs.
 *
 * Reconnect: exponential backoff capped at 30s, same shape as the provider.
 * Cleanup: closes the EventSource and clears timers on unmount.
 *
 * Consumers read `connected` to decide whether to suspend polling and
 * `lastEvent` to trigger a refetch (kept as a signal-like ref so callers can
 * `useEffect` on identity changes).
 */

import { useEffect, useRef, useState } from "preact/hooks";
import type { InvoiceUpdatedPayload } from "@/src/services/event-bus.service.ts";

export interface UseInvoiceSseResult {
  connected: boolean;
  lastEvent: InvoiceUpdatedPayload | null;
  close: () => void;
}

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

export function useInvoiceSse(
  invoiceId: string | null | undefined,
): UseInvoiceSseResult {
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<InvoiceUpdatedPayload | null>(
    null,
  );
  const closeRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!invoiceId) return;
    if (typeof globalThis === "undefined" || typeof document === "undefined") {
      return;
    }

    let cancelled = false;
    let es: EventSource | null = null;
    let attempt = 0;
    let reconnectTimer: number | null = null;
    let lastId: number | null = null;

    const connect = () => {
      if (cancelled) return;
      const base = `/api/stream/invoices?invoiceId=${
        encodeURIComponent(invoiceId)
      }`;
      // Cache-bust on reconnect so intermediaries don't replay a stale 503.
      const url = lastId ? `${base}&_ts=${Date.now()}` : base;
      es = new EventSource(url, { withCredentials: true });

      es.onopen = () => {
        attempt = 0;
        setConnected(true);
      };

      es.addEventListener("invoice.updated", (e: MessageEvent) => {
        try {
          const payload = e.data
            ? JSON.parse(e.data) as InvoiceUpdatedPayload
            : null;
          if (e.lastEventId) {
            const seq = parseInt(e.lastEventId, 10);
            if (Number.isFinite(seq) && seq > 0) lastId = seq;
          }
          if (payload) setLastEvent(payload);
        } catch {
          // Server frames are JSON by contract; ignore malformed frames.
        }
      });

      es.addEventListener("heartbeat", () => {
        setConnected(true);
      });

      es.onerror = () => {
        es?.close();
        es = null;
        if (cancelled) return;
        setConnected(false);
        attempt += 1;
        const delay = Math.min(
          RECONNECT_BASE_MS * Math.pow(2, attempt),
          RECONNECT_MAX_MS,
        );
        reconnectTimer = globalThis.setTimeout(connect, delay);
      };
    };

    const cleanup = () => {
      cancelled = true;
      if (reconnectTimer !== null) {
        globalThis.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      try {
        es?.close();
      } catch {
        /* ignore */
      }
      es = null;
      setConnected(false);
    };

    closeRef.current = cleanup;
    connect();
    return cleanup;
  }, [invoiceId]);

  return {
    connected,
    lastEvent,
    close: () => closeRef.current(),
  };
}

/**
 * SseProvider (Phase P7)
 *
 * A single tab-scoped island that holds the browser's EventSource connections
 * to `/api/stream/chargers` and `/api/notifications/stream`, then fans
 * received events out to two audiences:
 *
 *   1. Other islands in the same tab — via a minimal in-page emitter exposed
 *      through the `useSseEvent(type, handler)` hook.
 *   2. Other tabs in the same browser — via a `BroadcastChannel`. The leader
 *      tab (first to acquire the channel lock) is the only one that actually
 *      holds the EventSource; follower tabs consume mirrored events. This
 *      keeps connection count down to 1 per browser which matters under the
 *      100-connection/worker cap documented in `src/lib/sse.ts`.
 *
 * Reconnect: native EventSource already reconnects, but we back off manually
 * on hard errors so transient outages don't hammer the server. Capped at 30s.
 *
 * Graceful fallback: if `ENABLE_SSE=false` on the server the endpoints reply
 * 503 and native EventSource will retry indefinitely; consumers watching the
 * `__sseConnected` signal see `false` and switch to polling. Islands must
 * continue to implement polling paths — SSE is an optimization, not a
 * requirement.
 */

import { useEffect } from "preact/hooks";
import { signal } from "@preact/signals";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type SseEventType =
  | "notification.created"
  | "notification.read"
  | "invoice.updated"
  | "charger.state"
  | "transaction.meter"
  | "tag.seen"
  | "sync.completed";

export interface MirroredEvent {
  type: SseEventType;
  payload: unknown;
  /** Server-side seq id; monotonic per worker. */
  seq?: number;
}

/** Reactive "is any upstream EventSource connected" flag. */
export const sseConnected = signal<boolean>(false);

// In-page emitter (tab-local).
type Handler = (payload: unknown) => void;
const listeners = new Map<SseEventType, Set<Handler>>();

function emit(type: SseEventType, payload: unknown): void {
  const set = listeners.get(type);
  if (!set) return;
  for (const h of set) {
    try {
      h(payload);
    } catch {
      // Isolate subscriber failures.
    }
  }
}

/** Subscribe to an SSE event type within this tab. Returns an unsubscribe fn. */
export function subscribeSse(type: SseEventType, handler: Handler): () => void {
  let set = listeners.get(type);
  if (!set) {
    set = new Set();
    listeners.set(type, set);
  }
  set.add(handler);
  return () => {
    set!.delete(handler);
  };
}

/** Hook wrapper for islands — mirrors `subscribeSse` to effect lifecycle. */
export function useSseEvent<T = unknown>(
  type: SseEventType,
  handler: (payload: T) => void,
): void {
  useEffect(() => {
    return subscribeSse(type, handler as Handler);
  }, [type]);
}

// ---------------------------------------------------------------------------
// Leader election + transport
// ---------------------------------------------------------------------------

const STREAMS: Array<{
  url: string;
  types: SseEventType[];
  /** Last-Event-ID snapshot so reconnects can request replay. */
  lastId: number | null;
}> = [
  {
    url: "/api/stream/chargers",
    types: [
      "charger.state",
      "transaction.meter",
      "tag.seen",
      "sync.completed",
    ],
    lastId: null,
  },
  {
    url: "/api/notifications/stream",
    types: ["notification.created", "notification.read"],
    lastId: null,
  },
];

const CHANNEL_NAME = "expressync-sse-v1";
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

/**
 * Single-component island — mount once in `_app.tsx`. Renders nothing.
 */
export default function SseProvider() {
  useEffect(() => {
    if (typeof globalThis === "undefined" || typeof document === "undefined") {
      return;
    }

    // BroadcastChannel isn't available in ancient browsers; fall back to a
    // per-tab connection. The provider still works, it just won't dedupe
    // across tabs.
    const hasBC = typeof BroadcastChannel !== "undefined";
    const channel: BroadcastChannel | null = hasBC
      ? new BroadcastChannel(CHANNEL_NAME)
      : null;

    // Leader election via Web Locks. Only the leader opens EventSources.
    let isLeader = false;
    const eventSources: EventSource[] = [];
    let cancelled = false;

    const handleIncoming = (ev: MirroredEvent) => {
      emit(ev.type, ev.payload);
    };

    // Follower receives mirrored events from the leader tab.
    if (channel) {
      channel.onmessage = (e: MessageEvent) => {
        const data = e.data as MirroredEvent | { __leader?: boolean };
        if (!data || typeof data !== "object") return;
        if ("type" in data && data.type) {
          handleIncoming(data as MirroredEvent);
        }
      };
    }

    const openStream = (spec: typeof STREAMS[number]) => {
      if (cancelled) return;
      let attempt = 0;

      const connect = () => {
        if (cancelled) return;
        const url = spec.lastId ? `${spec.url}?_ts=${Date.now()}` : spec.url;
        const es = new EventSource(url, { withCredentials: true });
        eventSources.push(es);

        es.onopen = () => {
          attempt = 0;
          sseConnected.value = true;
        };

        const onTypedEvent = (type: SseEventType) => (e: MessageEvent) => {
          try {
            const payload = e.data ? JSON.parse(e.data) : null;
            const seq = e.lastEventId
              ? parseInt(e.lastEventId, 10) || undefined
              : undefined;
            if (seq) spec.lastId = seq;
            const mirrored: MirroredEvent = { type, payload, seq };
            handleIncoming(mirrored);
            channel?.postMessage(mirrored);
          } catch {
            // Ignore parse failures; server frames are JSON by contract.
          }
        };

        for (const t of spec.types) {
          es.addEventListener(t, onTypedEvent(t) as EventListener);
        }

        es.addEventListener("heartbeat", () => {
          sseConnected.value = true;
        });

        es.onerror = () => {
          // 503 or network blip — close and schedule exponential backoff.
          es.close();
          const idx = eventSources.indexOf(es);
          if (idx >= 0) eventSources.splice(idx, 1);
          if (cancelled) return;

          // Reflect disconnect if no sources remain open.
          if (eventSources.every((s) => s.readyState !== EventSource.OPEN)) {
            sseConnected.value = false;
          }

          attempt += 1;
          const delay = Math.min(
            RECONNECT_BASE_MS * Math.pow(2, attempt),
            RECONNECT_MAX_MS,
          );
          setTimeout(connect, delay);
        };
      };

      connect();
    };

    const becomeLeader = () => {
      if (isLeader || cancelled) return;
      isLeader = true;
      for (const spec of STREAMS) openStream(spec);
    };

    // Try to acquire the leader lock. Web Locks is widely supported; if
    // unavailable, every tab becomes its own leader (which is fine under the
    // 100-connection cap for typical admin usage).
    // deno-lint-ignore no-explicit-any
    const nav = (globalThis as any).navigator;
    if (nav?.locks?.request) {
      nav.locks.request(
        "expressync-sse-leader",
        { mode: "exclusive" },
        () =>
          // Hold the lock for the lifetime of the tab by returning a pending
          // promise. Resolves when we're unmounted.
          new Promise<void>((resolve) => {
            becomeLeader();
            const release = () => {
              resolve();
            };
            globalThis.addEventListener("pagehide", release, { once: true });
            // Cleanup below also triggers release via cancelled flag + resolve.
            (globalThis as unknown as { __sseReleaseLeader?: () => void })
              .__sseReleaseLeader = release;
          }),
      );
    } else {
      becomeLeader();
    }

    return () => {
      cancelled = true;
      for (const es of eventSources) {
        try {
          es.close();
        } catch {
          /* ignore */
        }
      }
      eventSources.length = 0;
      sseConnected.value = false;
      try {
        (globalThis as unknown as { __sseReleaseLeader?: () => void })
          .__sseReleaseLeader?.();
      } catch {
        /* ignore */
      }
      try {
        channel?.close();
      } catch {
        /* ignore */
      }
    };
  }, []);

  return null;
}

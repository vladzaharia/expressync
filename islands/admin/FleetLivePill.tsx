/**
 * FleetLivePill — sidebar-mounted live-fleet status pill.
 *
 * Subscribes to `transaction.meter` SSE events globally, tracks active
 * sessions in a Map keyed by transactionId, and TTLs out entries that
 * haven't reported in 90s. Renders a small "<N> live · <kW> kW" pill with
 * a pulsing emerald dot. Returns `null` when no active sessions exist so
 * the sidebar stays clean during quiet periods.
 */

import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { Zap } from "lucide-preact";
import { subscribeSse } from "@/islands/shared/SseProvider.tsx";
import { clientNavigate } from "@/src/lib/nav.ts";
import { cn } from "@/src/lib/utils/cn.ts";

interface MeterPayload {
  transactionId: number | string;
  chargeBoxId?: string;
  kwh?: number;
  powerKw?: number;
  meterTimestamp?: string;
  endedAt?: string;
}

const TTL_MS = 90_000;
const FLUSH_MS = 250;

export default function FleetLivePill() {
  const sessions = useSignal<number>(0);
  const totalKw = useSignal<number>(0);

  useEffect(() => {
    const map = new Map<string, { kw: number; lastSeen: number }>();
    let dirty = false;
    let flushHandle: number | null = null;

    const flush = () => {
      flushHandle = null;
      if (!dirty) return;
      dirty = false;
      // GC entries that haven't reported in TTL.
      const cutoff = Date.now() - TTL_MS;
      let kw = 0;
      for (const [k, v] of map) {
        if (v.lastSeen < cutoff) {
          map.delete(k);
        } else {
          kw += v.kw;
        }
      }
      sessions.value = map.size;
      totalKw.value = kw;
    };

    const schedule = () => {
      dirty = true;
      if (flushHandle !== null) return;
      flushHandle = setTimeout(flush, FLUSH_MS) as unknown as number;
    };

    const unsub = subscribeSse("transaction.meter", (raw) => {
      const p = raw as MeterPayload;
      const id = String(p.transactionId);
      if (p.endedAt) {
        map.delete(id);
        schedule();
        return;
      }
      const kw = typeof p.powerKw === "number" && Number.isFinite(p.powerKw)
        ? Math.max(0, p.powerKw)
        : (map.get(id)?.kw ?? 0);
      map.set(id, { kw, lastSeen: Date.now() });
      schedule();
    });

    // Periodic TTL sweep so stale sessions disappear even without new events.
    const sweep = setInterval(() => {
      schedule();
    }, 5_000);

    return () => {
      unsub();
      clearInterval(sweep);
      if (flushHandle !== null) clearTimeout(flushHandle);
    };
  }, []);

  if (sessions.value === 0) return null;

  return (
    <button
      type="button"
      onClick={() => clientNavigate("/transactions?status=active")}
      aria-label={`${sessions.value} live sessions, ${
        totalKw.value.toFixed(1)
      } kW total`}
      class={cn(
        "hidden md:inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
        "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        "hover:bg-emerald-500/20",
      )}
    >
      <span class="relative flex size-2">
        <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span class="relative inline-flex size-2 rounded-full bg-emerald-500" />
      </span>
      <Zap class="size-3.5" aria-hidden="true" />
      <span class="tabular-nums">
        {sessions.value} live · {totalKw.value.toFixed(1)} kW
      </span>
    </button>
  );
}

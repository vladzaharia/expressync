/**
 * TransactionsLiveBanner — small SectionCard banner that shows live session
 * counts above the transactions table. Subscribes to `transaction.meter`
 * SSE events, TTLs entries after 90s of silence, and renders nothing when
 * there are no active sessions.
 */

import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { Activity } from "lucide-preact";
import { SectionCard } from "@/components/shared/SectionCard.tsx";
import { subscribeSse } from "@/islands/shared/SseProvider.tsx";

interface MeterPayload {
  transactionId: number | string;
  powerKw?: number;
  endedAt?: string;
}

const TTL_MS = 90_000;
const FLUSH_MS = 250;

export default function TransactionsLiveBanner() {
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

    const sweep = setInterval(schedule, 5_000);

    return () => {
      unsub();
      clearInterval(sweep);
      if (flushHandle !== null) clearTimeout(flushHandle);
    };
  }, []);

  if (sessions.value === 0) return null;

  return (
    <div class="mb-4">
      <SectionCard
        title={`${sessions.value} session${
          sessions.value === 1 ? "" : "s"
        } live · ${totalKw.value.toFixed(1)} kW`}
        description="Live readings from chargers reporting in the last 90 seconds"
        icon={Activity}
        accent="emerald"
        borderBeam
      >
        <div class="flex items-center gap-2 text-xs text-muted-foreground">
          <span class="relative flex size-2">
            <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span class="relative inline-flex size-2 rounded-full bg-emerald-500" />
          </span>
          Updates streaming over SSE — entries time out after 90s of silence.
        </div>
      </SectionCard>
    </div>
  );
}

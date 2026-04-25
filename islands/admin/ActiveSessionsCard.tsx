/**
 * ActiveSessionsCard — dashboard live-sessions widget.
 *
 * Pure client-side aggregation from `transaction.meter` SSE events. Shows up
 * to 10 active sessions ordered by most recently seen. TTLs out entries that
 * haven't reported in 90s. Renders nothing when no sessions are active so the
 * dashboard stays uncluttered between charges.
 */

import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { Activity } from "lucide-preact";
import { SectionCard } from "@/components/shared/SectionCard.tsx";
import { subscribeSse } from "@/islands/shared/SseProvider.tsx";
import { cn } from "@/src/lib/utils/cn.ts";

interface MeterPayload {
  transactionId: number | string;
  chargeBoxId?: string;
  connectorId?: number;
  kwh?: number;
  powerKw?: number;
  meterTimestamp?: string;
  endedAt?: string;
}

interface SessionEntry {
  transactionId: string;
  chargeBoxId: string;
  connectorId: number | null;
  kw: number;
  kwh: number;
  startedMs: number;
  lastSeen: number;
}

const TTL_MS = 90_000;
const FLUSH_MS = 250;
const MAX_ROWS = 10;

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export default function ActiveSessionsCard() {
  const rows = useSignal<SessionEntry[]>([]);
  // Tick signal so elapsed times re-render every second.
  const _tick = useSignal<number>(0);

  useEffect(() => {
    const map = new Map<string, SessionEntry>();
    let dirty = false;
    let flushHandle: number | null = null;

    const recompute = () => {
      flushHandle = null;
      if (!dirty) return;
      dirty = false;
      const cutoff = Date.now() - TTL_MS;
      const kept: SessionEntry[] = [];
      for (const [k, v] of map) {
        if (v.lastSeen < cutoff) {
          map.delete(k);
        } else {
          kept.push(v);
        }
      }
      kept.sort((a, b) => b.lastSeen - a.lastSeen);
      rows.value = kept.slice(0, MAX_ROWS);
    };

    const schedule = () => {
      dirty = true;
      if (flushHandle !== null) return;
      flushHandle = setTimeout(recompute, FLUSH_MS) as unknown as number;
    };

    const unsub = subscribeSse("transaction.meter", (raw) => {
      const p = raw as MeterPayload;
      const id = String(p.transactionId);
      if (p.endedAt) {
        map.delete(id);
        schedule();
        return;
      }
      const prev = map.get(id);
      const now = Date.now();
      const kw = typeof p.powerKw === "number" && Number.isFinite(p.powerKw)
        ? Math.max(0, p.powerKw)
        : (prev?.kw ?? 0);
      const kwh = typeof p.kwh === "number" && Number.isFinite(p.kwh)
        ? p.kwh
        : (prev?.kwh ?? 0);
      map.set(id, {
        transactionId: id,
        chargeBoxId: p.chargeBoxId ?? prev?.chargeBoxId ?? "",
        connectorId: p.connectorId ?? prev?.connectorId ?? null,
        kw,
        kwh,
        startedMs: prev?.startedMs ?? now,
        lastSeen: now,
      });
      schedule();
    });

    // Sweep stale entries + drive elapsed re-render once a second.
    const sweep = setInterval(() => {
      _tick.value = Date.now();
      schedule();
    }, 1_000);

    return () => {
      unsub();
      clearInterval(sweep);
      if (flushHandle !== null) clearTimeout(flushHandle);
    };
  }, []);

  if (rows.value.length === 0) return null;

  return (
    <SectionCard
      title="Active charging sessions"
      description={`${rows.value.length} live`}
      icon={Activity}
      accent="emerald"
      borderBeam
    >
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="text-xs text-muted-foreground">
            <tr class="border-b">
              <th class="py-2 text-left font-medium">Charger</th>
              <th class="py-2 text-left font-medium">Conn.</th>
              <th class="py-2 text-right font-medium">kW</th>
              <th class="py-2 text-right font-medium">kWh</th>
              <th class="py-2 text-right font-medium">Elapsed</th>
            </tr>
          </thead>
          <tbody>
            {rows.value.map((r) => (
              <tr key={r.transactionId} class="border-b last:border-b-0">
                <td class="py-2">
                  {r.chargeBoxId
                    ? (
                      <a
                        href={`/chargers/${r.chargeBoxId}`}
                        class={cn(
                          "font-mono text-xs hover:underline",
                          "text-emerald-700 dark:text-emerald-300",
                        )}
                      >
                        {r.chargeBoxId}
                      </a>
                    )
                    : <span class="text-muted-foreground text-xs">—</span>}
                </td>
                <td class="py-2 font-mono text-xs">
                  {r.connectorId ?? "—"}
                </td>
                <td class="py-2 text-right font-medium tabular-nums">
                  {r.kw.toFixed(1)}
                </td>
                <td class="py-2 text-right font-medium tabular-nums">
                  {r.kwh.toFixed(2)}
                </td>
                <td class="py-2 text-right text-muted-foreground tabular-nums">
                  {formatElapsed(Date.now() - r.startedMs)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

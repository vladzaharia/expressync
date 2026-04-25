/**
 * LiveSessionCard (Wave C2)
 *
 * Rendered at the top of `/transactions/[id]` when the session is still in
 * progress (i.e. `transaction_sync_state.isFinalized !== true`). Subscribes
 * to `transaction.meter` SSE events for live kWh updates and recomputes an
 * elapsed-time tile once per second from `startedAt`.
 *
 * Degrades gracefully when SSE is disabled: the initial `kwh`, `startedAt`,
 * and chargeBoxId still render; the Live dot just never turns green and the
 * "last meter update" tile stays at "—".
 */

import { useEffect } from "preact/hooks";
import { computed, signal, useSignal } from "@preact/signals";
import {
  Activity,
  BatteryCharging,
  Clock,
  MapPin,
  StopCircle,
  Zap,
} from "lucide-preact";
import { MetricTile } from "@/components/shared/MetricTile.tsx";
import { Button } from "@/components/ui/button.tsx";
import { sseConnected, subscribeSse } from "@/islands/shared/SseProvider.tsx";
import {
  formatRelative,
  formatSessionDuration,
} from "@/islands/shared/charger-visuals.ts";
import { cn } from "@/src/lib/utils/cn.ts";

interface TransactionMeterPayload {
  transactionId: number | string;
  chargeBoxId: string;
  kwh?: number;
  endedAt?: string;
}

interface Props {
  steveTransactionId: number;
  chargeBoxId: string | null;
  /** Operator-set friendly name (mirrored from StEvE description). */
  friendlyName?: string | null;
  connectorId?: number | null;
  initialKwh: number;
  /** ISO timestamp when charging started; null if unknown. */
  startedAt: string | null;
  isAdmin?: boolean;
}

// A global "now" signal ticked once per second so every MetricTile that needs
// the current time can re-read without each tile owning its own interval.
const nowTick = signal<number>(Date.now());
let tickCount = 0;
let tickHandle: number | null = null;
function subscribeTick(): () => void {
  tickCount++;
  if (tickHandle === null) {
    tickHandle = setInterval(() => {
      nowTick.value = Date.now();
    }, 1000) as unknown as number;
  }
  return () => {
    tickCount--;
    if (tickCount <= 0 && tickHandle !== null) {
      clearInterval(tickHandle);
      tickHandle = null;
      tickCount = 0;
    }
  };
}

export default function LiveSessionCard(props: Props) {
  const kwh = useSignal<number>(props.initialKwh);
  const lastUpdateMs = useSignal<number | null>(null);
  const ended = useSignal<boolean>(false);

  useEffect(() => {
    const unsub = subscribeSse("transaction.meter", (raw) => {
      const payload = raw as TransactionMeterPayload;
      const payloadTxId = typeof payload.transactionId === "string"
        ? parseInt(payload.transactionId, 10)
        : payload.transactionId;
      if (payloadTxId !== props.steveTransactionId) return;
      if (typeof payload.kwh === "number" && Number.isFinite(payload.kwh)) {
        kwh.value = payload.kwh;
      }
      lastUpdateMs.value = Date.now();
      if (payload.endedAt) {
        ended.value = true;
      }
    });
    const unsubTick = subscribeTick();
    return () => {
      unsub();
      unsubTick();
    };
  }, [props.steveTransactionId]);

  // Recompute elapsed + relative-last-update from the shared tick signal.
  const elapsedText = computed(() => {
    // Reference the tick signal so the computation re-runs every second.
    void nowTick.value;
    return props.startedAt ? formatSessionDuration(props.startedAt) : "—";
  });
  const lastUpdateText = computed(() => {
    void nowTick.value;
    if (lastUpdateMs.value === null) return "—";
    return formatRelative(new Date(lastUpdateMs.value).toISOString());
  });

  const isLive = sseConnected.value && !ended.value;

  return (
    <div
      class={cn(
        "relative rounded-lg border bg-card p-5",
        "border-emerald-500/30",
      )}
    >
      <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          <h2 class="text-base font-semibold">Live Session</h2>
          <LiveIndicator active={isLive} ended={ended.value} />
        </div>
        <div class="flex items-center gap-2">
          {props.chargeBoxId && props.isAdmin && !ended.value && (
            <Button variant="outline" size="sm" asChild>
              <a
                href={`/chargers/${encodeURIComponent(props.chargeBoxId)}`}
                class="inline-flex items-center gap-1.5"
                aria-label="Open charger to stop this session"
              >
                <StopCircle class="size-4" />
                Stop charging
              </a>
            </Button>
          )}
        </div>
      </div>

      <div class="grid grid-cols-2 md:grid-cols-4 gap-6 py-2">
        <MetricTile
          icon={BatteryCharging}
          label="Current kWh"
          value={<span class="tabular-nums">{kwh.value.toFixed(3)} kWh</span>}
          accent="emerald"
        />
        <MetricTile
          icon={Clock}
          label="Elapsed"
          value={<span class="tabular-nums">{elapsedText.value}</span>}
          accent="amber"
        />
        <MetricTile
          icon={Activity}
          label="Last meter update"
          value={<span class="tabular-nums">{lastUpdateText.value}</span>}
          sublabel={ended.value ? "Session ended" : undefined}
          accent={ended.value ? "slate" : "green"}
        />
        {props.chargeBoxId
          ? (() => {
            const friendly = props.friendlyName?.trim() ?? "";
            const showChip = friendly.length > 0 &&
              friendly !== props.chargeBoxId;
            return (
              <MetricTile
                icon={MapPin}
                label="Charger"
                value={
                  <a
                    href={`/chargers/${encodeURIComponent(props.chargeBoxId)}`}
                    class="inline-flex items-baseline gap-2 hover:underline"
                  >
                    <span class="text-sm font-medium">
                      {friendly || props.chargeBoxId}
                    </span>
                    {showChip
                      ? (
                        <span class="font-mono text-xs text-muted-foreground">
                          {props.chargeBoxId}
                        </span>
                      )
                      : null}
                  </a>
                }
                sublabel={props.connectorId != null
                  ? `Connector ${props.connectorId}`
                  : undefined}
                accent="cyan"
              />
            );
          })()
          : (
            <MetricTile
              icon={Zap}
              label="Session"
              value={
                <span class="font-mono text-sm">
                  #{props.steveTransactionId}
                </span>
              }
              accent="blue"
            />
          )}
      </div>

      {ended.value && (
        <p class="mt-3 text-xs text-muted-foreground">
          Session ended — final totals will appear here after the next sync.
        </p>
      )}
    </div>
  );
}

function LiveIndicator({ active, ended }: { active: boolean; ended: boolean }) {
  if (ended) {
    return (
      <span class="inline-flex items-center gap-1.5 rounded-full border border-muted bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
        <span class="size-1.5 rounded-full bg-muted-foreground/50" />
        Ended
      </span>
    );
  }
  if (active) {
    return (
      <span
        class="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300"
        title="Live telemetry streaming"
      >
        <span class="relative flex size-2">
          <span class="absolute inline-flex size-2 animate-ping rounded-full bg-emerald-500 opacity-75" />
          <span class="relative inline-flex size-2 rounded-full bg-emerald-500" />
        </span>
        Live
      </span>
    );
  }
  return (
    <span
      class="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300"
      title="Live telemetry unavailable — refresh for latest values"
    >
      <span class="size-1.5 rounded-full bg-amber-500" />
      Offline
    </span>
  );
}

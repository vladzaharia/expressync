/**
 * ActiveSessionBanner — sticky 48px strip rendered above customer pages
 * during an active charging session.
 *
 * Live data:
 *   • subscribes to `transaction.meter` SSE events for kW + kWh updates
 *   • subscribes to `transaction.end` (and `endedAt`-flagged meter events)
 *     to slide-out when the session terminates
 *   • SSE-disconnect fallback: shows `WifiOff` + 5s polling on
 *     `/api/customer/sessions?status=active&limit=1`
 *
 * Layout:
 *   • Desktop (≥md): 🟢 EVSE-1 · Type 2 │ 12.4 kW │ 23:14 │ €3.40 │ [Stop]
 *   • Mobile (<md):  🟢 12.4 kW │ 23:14 │ €3.40 │ [Stop]
 *
 * Stop opens the shared `ConfirmDialog` (variant="destructive") with the
 * current kWh + cost in the body. On confirm, POSTs to
 * `/api/customer/session-stop`. The 5s undo toast is owned by the parent
 * dashboard (so a single source of truth across HeroSessionCard + Banner).
 *
 * z-index 30 (below ImpersonationBanner z-35 and Dialog z-50; above the
 * mobile bottom-tab z-40 — they don't overlap because banner sits at top,
 * tab sits at bottom).
 */

import { useEffect, useState } from "preact/hooks";
import { computed, signal, useSignal } from "@preact/signals";
import { StopCircle, WifiOff } from "lucide-preact";
import { Button } from "@/components/ui/button.tsx";
import ConfirmDialog from "@/components/shared/ConfirmDialog.tsx";
import { NumberTicker } from "@/components/magicui/number-ticker.tsx";
import { BorderBeam } from "@/components/magicui/border-beam.tsx";
import { sseConnected, subscribeSse } from "@/islands/shared/SseProvider.tsx";
import { formatSessionDuration } from "@/islands/shared/charger-visuals.ts";
import { cn } from "@/src/lib/utils/cn.ts";
import { toast } from "sonner";

interface ActiveSession {
  steveTransactionId: number;
  chargeBoxId: string | null;
  connectorType?: string | null;
  connectorId?: number | null;
  /** Current power draw, kW. */
  powerKw?: number;
  /** Total energy, kWh. */
  kwh: number;
  /** ISO start timestamp. */
  startedAt: string | null;
  /** Estimated cost in the user's currency, e.g. 3.4. */
  estimatedCost?: number;
  currencySymbol?: string;
}

interface Props {
  initial: ActiveSession | null;
}

interface MeterPayload {
  transactionId: number | string;
  chargeBoxId?: string;
  kwh?: number;
  powerKw?: number;
  endedAt?: string;
}

const nowTick = signal<number>(Date.now());
let tickHandle: number | null = null;
let tickCount = 0;
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

export default function ActiveSessionBanner({ initial }: Props) {
  const session = useSignal<ActiveSession | null>(initial);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [stopping, setStopping] = useState(false);

  // SSE → keep the banner's kW/kWh in sync.
  useEffect(() => {
    const unsubMeter = subscribeSse("transaction.meter", (raw) => {
      const p = raw as MeterPayload;
      const cur = session.value;
      if (!cur) return;
      const txId = typeof p.transactionId === "string"
        ? parseInt(p.transactionId, 10)
        : p.transactionId;
      if (txId !== cur.steveTransactionId) return;
      session.value = {
        ...cur,
        kwh: typeof p.kwh === "number" && Number.isFinite(p.kwh)
          ? p.kwh
          : cur.kwh,
        powerKw: typeof p.powerKw === "number" && Number.isFinite(p.powerKw)
          ? p.powerKw
          : cur.powerKw,
      };
      if (p.endedAt) {
        session.value = null;
      }
    });
    const unsubTick = subscribeTick();
    return () => {
      unsubMeter();
      unsubTick();
    };
  }, []);

  // Polling fallback when SSE drops.
  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const poll = async () => {
      if (cancelled) return;
      if (sseConnected.value) {
        timer = setTimeout(poll, 5000) as unknown as number;
        return;
      }
      try {
        const res = await fetch(
          "/api/customer/sessions?status=active&limit=1",
        );
        if (res.ok) {
          const body = await res.json();
          const item = (body?.items && body.items[0]) ?? null;
          if (!item) {
            session.value = null;
          } else if (
            !session.value ||
            item.steveTransactionId !== session.value.steveTransactionId
          ) {
            session.value = {
              steveTransactionId: item.steveTransactionId,
              chargeBoxId: item.chargeBoxId ?? null,
              connectorType: null,
              connectorId: null,
              kwh: Number(item.kwhDelta) || 0,
              startedAt: item.syncedAt ?? null,
            };
          }
        }
      } catch (err) {
        console.warn("ActiveSessionBanner poll failed:", err);
      }
      timer = setTimeout(poll, 5000) as unknown as number;
    };
    timer = setTimeout(poll, 5000) as unknown as number;
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const elapsedText = computed(() => {
    void nowTick.value;
    return session.value?.startedAt
      ? formatSessionDuration(session.value.startedAt)
      : "—";
  });

  const handleStop = async () => {
    const cur = session.value;
    if (!cur) return;
    setStopping(true);
    try {
      const res = await fetch("/api/customer/session-stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionId: cur.steveTransactionId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "Failed to stop session");
      }
      toast.success("Stopping…", {
        description: "We've asked the charger to stop. You can undo for 5s.",
        duration: 5000,
        action: {
          label: "Undo",
          onClick: () => {
            // Track G2 owns the real resume flow; for now log + toast.
            toast.info("Resume not yet wired — Track G2 owns scan-start.");
          },
        },
      });
      // Optimistic: clear the banner immediately.
      session.value = null;
      setConfirmOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to stop";
      toast.error(msg);
    } finally {
      setStopping(false);
    }
  };

  if (!session.value) return null;

  const s = session.value;
  const power = s.powerKw ?? 0;
  const cost = s.estimatedCost ?? 0;
  const currency = s.currencySymbol ?? "€";
  const showOffline = !sseConnected.value;

  return (
    <>
      <div
        role="status"
        aria-live="polite"
        class={cn(
          "sticky top-0 z-30 flex h-12 items-center gap-3 px-3",
          "border-b border-emerald-500/40 bg-emerald-500/10 backdrop-blur-sm",
          "text-sm overflow-hidden",
        )}
      >
        <BorderBeam
          size={120}
          duration={6}
          colorFrom="oklch(0.75 0.22 145)"
          colorTo="oklch(0.70 0.20 155)"
          className="opacity-90"
        />

        <a
          href="/?scrollTo=hero"
          class="flex flex-1 min-w-0 items-center gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
          aria-label="Open dashboard hero session"
        >
          <span class="relative flex size-2.5 shrink-0">
            <span
              class="absolute inline-flex size-2.5 rounded-full bg-emerald-500 opacity-75 motion-safe:animate-ping"
              aria-hidden="true"
            />
            <span class="relative inline-flex size-2.5 rounded-full bg-emerald-500" />
          </span>

          {/* Charger label — desktop only */}
          {s.chargeBoxId && (
            <span class="hidden md:inline-flex items-center gap-1 truncate font-mono text-xs text-foreground">
              {s.chargeBoxId}
              {s.connectorType && (
                <span class="text-muted-foreground">· {s.connectorType}</span>
              )}
            </span>
          )}
          <span
            class="text-muted-foreground hidden md:inline"
            aria-hidden="true"
          >
            │
          </span>

          {/* Power kW (live) */}
          <span class="inline-flex items-baseline gap-1 tabular-nums">
            <NumberTicker
              value={power}
              decimalPlaces={1}
              duration={400}
              className="font-semibold"
            />
            <span class="text-muted-foreground">kW</span>
          </span>

          <span class="text-muted-foreground" aria-hidden="true">│</span>

          {/* Elapsed */}
          <span class="tabular-nums">
            {elapsedText.value}
          </span>

          <span class="text-muted-foreground" aria-hidden="true">│</span>

          {/* Cost */}
          <span class="tabular-nums">
            {currency}
            {cost.toFixed(2)}
          </span>

          {showOffline && (
            <span
              class="ml-auto inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400"
              title="Live updates unavailable — polling for updates"
            >
              <WifiOff class="size-3.5" />
            </span>
          )}
        </a>

        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={() => setConfirmOpen(true)}
          aria-label="Stop charging"
          class="shrink-0"
        >
          <StopCircle class="size-3.5" />
          <span class="hidden sm:inline">Stop</span>
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Stop charging?"
        description={
          <span>
            You're about to stop charging on{" "}
            <span class="font-mono">{s.chargeBoxId ?? "the charger"}</span>.
            Current usage:{" "}
            <span class="font-semibold tabular-nums">
              {s.kwh.toFixed(2)} kWh
            </span>{" "}
            ({currency}
            {cost.toFixed(2)}). You can undo this for 5 seconds.
          </span>
        }
        variant="destructive"
        confirmLabel="Stop charging"
        icon={<StopCircle class="size-5 text-destructive" />}
        onConfirm={handleStop}
        isLoading={stopping}
      />
    </>
  );
}

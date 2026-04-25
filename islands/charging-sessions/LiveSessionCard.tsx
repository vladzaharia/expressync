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
  Gauge,
  MapPin,
  Route,
  StopCircle,
  Wallet,
  Zap,
} from "lucide-preact";
import { MetricTile } from "@/components/shared/MetricTile.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  sseConnected,
  type SseEventType,
  subscribeSse,
} from "@/islands/shared/SseProvider.tsx";
import {
  formatRelative,
  formatSessionDuration,
} from "@/islands/shared/charger-visuals.ts";
import { cn } from "@/src/lib/utils/cn.ts";

interface TransactionMeterPayload {
  transactionId: number | string;
  chargeBoxId: string;
  kwh?: number;
  powerKw?: number;
  meterTimestamp?: string;
  connectorId?: number;
  endedAt?: string;
}

/**
 * `transaction.billing` payload — emitted by the incremental Lago billing
 * pipeline once each meter event has been mirrored as a billable usage
 * record. Optimistically subscribed to; degrades gracefully if the event
 * type is never delivered (we just keep showing the estimate).
 */
interface TransactionBillingPayload {
  transactionId: number | string;
  billedKwh?: number;
  billedCostCents?: number;
  currencySymbol?: string;
  lagoEventTransactionId?: string;
  t?: string;
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
  /**
   * Per-kWh price for the customer's active plan. Server resolves this from
   * Lago at SSR time and passes it down so the card can render running
   * cost without making an API round-trip per meter tick. Omit to hide
   * the cost tile (e.g. flat-rate plans).
   */
  tariffPerKwh?: number;
  /** Currency symbol (or 3-letter code) shown next to the cost. Default "$". */
  currencySymbol?: string;
  /**
   * Vehicle efficiency in miles per kWh used to derive estimated range
   * added. Defaults to 4 mi/kWh — a reasonable mid-range for a typical
   * passenger EV. Override per-mapping when known.
   */
  milesPerKwh?: number;
  /**
   * Locale for distance display. "imperial" → miles, "metric" → km
   * (computed via DEFAULT_KM_PER_MILE). Default "imperial".
   */
  distanceUnit?: "imperial" | "metric";
  /**
   * Authoritative kWh as recorded by the billing pipeline (Lago events).
   * When present, the cost tile shows "$X.XX billed" instead of the
   * estimate. SSE `transaction.billing` events update this live.
   */
  billedKwh?: number;
  /**
   * Authoritative billed cost in cents. SSE `transaction.billing` events
   * update this live.
   */
  billedCostCents?: number;
  /**
   * Customer wallet balance in cents. When set, renders an extra tile
   * comparing balance to estimated cost (emerald > 2×, amber 1-2×, rose < 1×).
   */
  walletBalanceCents?: number;
  /**
   * Wallet auto-top-up threshold in cents (informational sublabel).
   */
  walletThresholdCents?: number;
}

const KM_PER_MILE = 1.60934;
const POWER_HISTORY_WINDOW_MS = 60_000;

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
  // Last-reported instantaneous power (kW). Falls back to a rolling-delta
  // estimate computed from the kWh history when the charger doesn't emit
  // Power.Active.Import samples.
  const reportedPowerKw = useSignal<number | null>(null);
  const rollingPowerKw = useSignal<number | null>(null);
  // Authoritative billed values from `transaction.billing` SSE events.
  // null means "no billing event received yet" — fall back to estimate.
  const billedKwh = useSignal<number | null>(
    props.billedKwh ?? null,
  );
  const billedCostCents = useSignal<number | null>(
    props.billedCostCents ?? null,
  );
  const billedCurrency = useSignal<string | null>(null);

  useEffect(() => {
    // Sliding-window history of (timestampMs, kwh) used to estimate kW
    // when the charger doesn't report Power.Active.Import. The delta
    // between the oldest in-window sample and the newest sample, scaled
    // to one hour, gives an instantaneous-ish kW.
    const history: { t: number; kwh: number }[] = [];

    const unsub = subscribeSse("transaction.meter", (raw) => {
      const payload = raw as TransactionMeterPayload;
      const payloadTxId = typeof payload.transactionId === "string"
        ? parseInt(payload.transactionId, 10)
        : payload.transactionId;
      if (payloadTxId !== props.steveTransactionId) return;
      const now = Date.now();
      if (typeof payload.kwh === "number" && Number.isFinite(payload.kwh)) {
        // Monotonic clamp: reconnects can replay older snapshots and we
        // never want the displayed kWh to snap backwards mid-session.
        kwh.value = Math.max(kwh.value, payload.kwh);
        history.push({ t: now, kwh: kwh.value });
        // Trim to the rolling window.
        const cutoff = now - POWER_HISTORY_WINDOW_MS;
        while (history.length > 0 && history[0].t < cutoff) history.shift();
        // Estimate kW: (kwh_now - kwh_oldest) / hours_elapsed.
        if (history.length >= 2) {
          const oldest = history[0];
          const newest = history[history.length - 1];
          const dh = (newest.t - oldest.t) / 3_600_000;
          if (dh > 0) {
            const est = (newest.kwh - oldest.kwh) / dh;
            // Clamp negatives (meter glitches) to 0; cap absurd values
            // at 350 kW so a single bad sample doesn't blow up the UI.
            rollingPowerKw.value = Math.max(0, Math.min(350, est));
          }
        }
      }
      if (typeof payload.powerKw === "number" && Number.isFinite(payload.powerKw)) {
        reportedPowerKw.value = Math.max(0, payload.powerKw);
      }
      lastUpdateMs.value = now;
      if (payload.endedAt) {
        ended.value = true;
      }
    });
    // Optimistically subscribe to `transaction.billing`. The event type may
    // not be wired yet on the server — `subscribeSse` accepts arbitrary
    // strings at runtime; if no events are emitted we just keep showing the
    // estimate. Cast through SseEventType so TS stays happy without
    // mutating the shared type union.
    const unsubBilling = subscribeSse(
      "transaction.billing" as SseEventType,
      (raw) => {
        const payload = raw as TransactionBillingPayload;
        const payloadTxId = typeof payload.transactionId === "string"
          ? parseInt(payload.transactionId, 10)
          : payload.transactionId;
        if (payloadTxId !== props.steveTransactionId) return;
        if (
          typeof payload.billedKwh === "number" &&
          Number.isFinite(payload.billedKwh)
        ) {
          billedKwh.value = Math.max(
            billedKwh.value ?? 0,
            payload.billedKwh,
          );
        }
        if (
          typeof payload.billedCostCents === "number" &&
          Number.isFinite(payload.billedCostCents)
        ) {
          billedCostCents.value = Math.max(
            billedCostCents.value ?? 0,
            payload.billedCostCents,
          );
        }
        if (typeof payload.currencySymbol === "string") {
          billedCurrency.value = payload.currencySymbol;
        }
      },
    );
    const unsubTick = subscribeTick();
    return () => {
      unsub();
      unsubBilling();
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

      <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 py-2">
        <MetricTile
          icon={BatteryCharging}
          label="Current kWh"
          value={<span class="tabular-nums">{kwh.value.toFixed(3)} kWh</span>}
          accent="emerald"
        />
        {(() => {
          // Prefer charger-reported power; fall back to rolling-delta
          // estimate; hide the tile entirely if we have neither yet.
          const power = reportedPowerKw.value ?? rollingPowerKw.value;
          if (power === null || ended.value) return null;
          const isEstimated = reportedPowerKw.value === null;
          return (
            <MetricTile
              icon={Gauge}
              label={isEstimated ? "Power (est.)" : "Power"}
              value={
                <span class="tabular-nums">
                  {power.toFixed(power >= 10 ? 1 : 2)} kW
                </span>
              }
              sublabel={isEstimated
                ? "60s rolling average"
                : undefined}
              accent="cyan"
            />
          );
        })()}
        {(() => {
          const tariff = props.tariffPerKwh;
          const hasTariff = tariff !== undefined && tariff > 0;
          const symbol = billedCurrency.value ?? props.currencySymbol ?? "$";
          const estimate = hasTariff ? kwh.value * tariff! : null;
          const billed = billedCostCents.value !== null
            ? billedCostCents.value / 100
            : null;
          // No tariff and no billed value → no tile at all (flat-rate plans).
          if (estimate === null && billed === null) return null;
          if (billed !== null) {
            // Show billed as primary; show estimate sublabel only when it
            // diverges from the billed total by more than 5%.
            const diverged = estimate !== null && estimate > 0 &&
              Math.abs(estimate - billed) / Math.max(estimate, 0.01) > 0.05;
            return (
              <MetricTile
                icon={Wallet}
                label="Cost"
                value={
                  <span class="tabular-nums">
                    {symbol}
                    {billed.toFixed(2)} <span class="text-xs font-normal text-muted-foreground">billed</span>
                  </span>
                }
                sublabel={diverged && estimate !== null
                  ? `est. ${symbol}${estimate.toFixed(2)}`
                  : hasTariff
                  ? `${symbol}${tariff!.toFixed(3)} / kWh`
                  : undefined}
                accent="emerald"
              />
            );
          }
          // No billed value yet — render the estimate (today's behaviour).
          return (
            <MetricTile
              icon={Wallet}
              label="Est. cost"
              value={
                <span class="tabular-nums">
                  {symbol}
                  {estimate!.toFixed(2)}
                </span>
              }
              sublabel={`${symbol}${tariff!.toFixed(3)} / kWh`}
              accent="emerald"
            />
          );
        })()}
        {(() => {
          // Wallet balance vs estimated cost. Color cue:
          //   emerald  if balance > 2× est cost  ("plenty")
          //   amber    if balance 1-2× est cost  ("watch")
          //   rose     if balance < 1× est cost  ("top up")
          const balance = props.walletBalanceCents;
          if (balance === undefined || balance === null) return null;
          const tariff = props.tariffPerKwh;
          const billed = billedCostCents.value;
          const estCents = billed !== null
            ? billed
            : tariff !== undefined && tariff > 0
            ? Math.round(kwh.value * tariff * 100)
            : 0;
          const symbol = billedCurrency.value ?? props.currencySymbol ?? "$";
          let tone: "emerald" | "amber" | "rose" = "emerald";
          if (estCents > 0) {
            if (balance < estCents) tone = "rose";
            else if (balance < estCents * 2) tone = "amber";
          }
          const threshold = props.walletThresholdCents;
          return (
            <MetricTile
              icon={Wallet}
              label="Wallet"
              value={
                <span class="tabular-nums">
                  {symbol}
                  {(balance / 100).toFixed(2)}
                </span>
              }
              sublabel={threshold !== undefined
                ? `auto top-up @ ${symbol}${(threshold / 100).toFixed(2)}`
                : tone === "rose"
                ? "below est. cost"
                : tone === "amber"
                ? "1-2× est. cost"
                : undefined}
              accent={tone}
            />
          );
        })()}
        {(() => {
          // Range tile: kWh × efficiency. Only show once the charger has
          // delivered something meaningful (>0.1 kWh) so the customer
          // doesn't see a flickery "+0 mi" early in the session.
          if (kwh.value < 0.1) return null;
          const mpk = props.milesPerKwh ?? 4;
          const distance = kwh.value * mpk;
          const isMetric = props.distanceUnit === "metric";
          const value = isMetric ? distance * KM_PER_MILE : distance;
          const unit = isMetric ? "km" : "mi";
          return (
            <MetricTile
              icon={Route}
              label="Range added"
              value={
                <span class="tabular-nums">
                  +{value.toFixed(value >= 100 ? 0 : 1)} {unit}
                </span>
              }
              sublabel={`@ ${mpk} mi/kWh`}
              accent="blue"
            />
          );
        })()}
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

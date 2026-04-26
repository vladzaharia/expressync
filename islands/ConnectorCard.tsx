/**
 * Per-connector card (island).
 *
 * Renders a single connector's status + inline action buttons. Clicking an
 * action opens the detail-page's `RemoteActionsPanel` dialog with the
 * correct operation + connectorId prefilled; we dispatch a custom event
 * upward because the panel is a sibling island.
 */

import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { Ban, Lock, Play, Square, Timer } from "lucide-preact";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { cn } from "@/src/lib/utils/cn.ts";
import { BorderBeam } from "@/components/magicui/border-beam.tsx";
import { subscribeSse } from "@/islands/shared/SseProvider.tsx";
import { formatSessionDuration } from "./shared/device-visuals.ts";

export type ConnectorUiStatus =
  | "Available"
  | "Preparing"
  | "Charging"
  | "Suspended"
  | "Finishing"
  | "Reserved"
  | "Unavailable"
  | "Faulted"
  | "Offline";

export interface ConnectorDto {
  connectorId: number;
  rawStatus: string | null;
  uiStatus: ConnectorUiStatus;
  errorCode: string | null;
  vendorErrorCode: string | null;
  info: string | null;
  updatedAtIso: string | null;
  activeTransactionId: number | null;
  activeSessionKwh: number | null;
  activeSessionStartIso: string | null;
  activeTagIdTag: string | null;
  activeTagTagPk: number | null;
  currentKw: number | null;
}

interface Props {
  chargeBoxId: string;
  connector: ConnectorDto;
  isAdmin: boolean;
}

interface StatusStyle {
  pillClass: string;
  dotClass: string;
  beam?: { from: string; to: string };
  dashed?: boolean;
}

/**
 * Plan-mandated connector color mapping:
 *   Available=emerald · Preparing/Finishing=sky · Charging/Suspended=amber
 *   (green halo when >0 kW) · Reserved=violet · Unavailable=zinc-400 ·
 *   Faulted=destructive (rose-600) · Offline=zinc-500 dashed.
 */
function styleFor(
  status: ConnectorUiStatus,
  isDrawingPower: boolean,
): StatusStyle {
  switch (status) {
    case "Available":
      return {
        pillClass:
          "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/40",
        dotClass: "bg-emerald-500",
      };
    case "Preparing":
    case "Finishing":
      return {
        pillClass:
          "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/40",
        dotClass: "bg-sky-500",
      };
    case "Charging":
    case "Suspended":
      return {
        pillClass: isDrawingPower
          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/40"
          : "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/40",
        dotClass: isDrawingPower ? "bg-emerald-500" : "bg-amber-500",
        beam: isDrawingPower
          ? { from: "oklch(0.75 0.15 145)", to: "oklch(0.70 0.18 150)" }
          : undefined,
      };
    case "Reserved":
      return {
        pillClass:
          "bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/40",
        dotClass: "bg-violet-500",
      };
    case "Unavailable":
      return {
        pillClass: "bg-zinc-400/10 text-zinc-500 border-zinc-400/40",
        dotClass: "bg-zinc-400",
      };
    case "Faulted":
      return {
        pillClass:
          "bg-rose-600/10 text-rose-700 dark:text-rose-400 border-rose-600/40",
        dotClass: "bg-rose-600",
      };
    case "Offline":
    default:
      return {
        pillClass: "bg-zinc-500/10 text-zinc-500 border-zinc-500/40",
        dotClass: "bg-zinc-500",
        dashed: true,
      };
  }
}

/**
 * Dispatch a custom event picked up by `RemoteActionsPanel` so it can open
 * the correct dialog with `chargeBoxId` + `connectorId` prefilled. Keeps the
 * two islands decoupled without forcing a shared signal.
 */
function launchAction(
  operation: string,
  params: Record<string, unknown>,
) {
  const evt = new CustomEvent("charger:open-action", {
    detail: { operation, params },
  });
  globalThis.dispatchEvent(evt);
}

export default function ConnectorCard(
  { chargeBoxId, connector, isAdmin }: Props,
) {
  // Live kW from SSE — overrides the SSR-rendered `connector.currentKw`
  // when meter events stream in. Filters strictly by chargeBoxId+connectorId.
  const liveKw = useSignal<number | null>(null);
  useEffect(() => {
    let lastSeen = 0;
    let dirty = false;
    let flushHandle: number | null = null;

    const flush = () => {
      flushHandle = null;
      if (!dirty) return;
      dirty = false;
      if (Date.now() - lastSeen > 90_000) liveKw.value = null;
    };
    const schedule = () => {
      dirty = true;
      if (flushHandle !== null) return;
      flushHandle = setTimeout(flush, 250) as unknown as number;
    };

    const unsub = subscribeSse("transaction.meter", (raw) => {
      const p = raw as {
        chargeBoxId?: string;
        connectorId?: number;
        powerKw?: number;
        endedAt?: string;
      };
      if (p.chargeBoxId !== chargeBoxId) return;
      if (p.connectorId !== connector.connectorId) return;
      if (p.endedAt) {
        liveKw.value = null;
        return;
      }
      if (typeof p.powerKw === "number" && Number.isFinite(p.powerKw)) {
        liveKw.value = Math.max(0, p.powerKw);
        lastSeen = Date.now();
        schedule();
      }
    });
    const sweep = setInterval(schedule, 5_000);
    return () => {
      unsub();
      clearInterval(sweep);
      if (flushHandle !== null) clearTimeout(flushHandle);
    };
  }, [chargeBoxId, connector.connectorId]);

  const hasActiveSession = connector.activeTransactionId !== null;
  const effectiveKw = liveKw.value ?? connector.currentKw;
  const isDrawingPower = (effectiveKw ?? 0) > 0 && hasActiveSession;
  const style = styleFor(connector.uiStatus, isDrawingPower);

  return (
    <div
      class={cn(
        "relative flex flex-col gap-3 overflow-hidden rounded-xl border bg-card p-4",
        style.dashed && "border-dashed",
      )}
    >
      <div class="flex items-center justify-between">
        <div class="text-sm font-semibold">
          Connector {connector.connectorId}
        </div>
        <span
          class={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
            style.pillClass,
          )}
        >
          <span
            aria-hidden="true"
            class={cn("size-1.5 rounded-full", style.dotClass)}
          />
          {connector.uiStatus}
        </span>
      </div>

      {connector.errorCode && (
        <div class="flex flex-col gap-0.5 rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1.5 text-xs text-rose-700 dark:text-rose-300">
          <span class="font-semibold">Error: {connector.errorCode}</span>
          {connector.vendorErrorCode && (
            <span class="font-mono text-[11px] opacity-80">
              vendor: {connector.vendorErrorCode}
            </span>
          )}
          {connector.info && (
            <span class="text-[11px] opacity-80">{connector.info}</span>
          )}
        </div>
      )}

      {hasActiveSession
        ? (
          <dl class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            <div class="col-span-2 flex items-center justify-between">
              <dt class="text-muted-foreground">Tag</dt>
              <dd>
                {connector.activeTagTagPk && connector.activeTagIdTag
                  ? (
                    <a
                      href={`/tags/${connector.activeTagTagPk}`}
                      class="font-mono font-medium hover:underline"
                    >
                      {connector.activeTagIdTag}
                    </a>
                  )
                  : (
                    <span class="font-mono">
                      {connector.activeTagIdTag ?? "—"}
                    </span>
                  )}
              </dd>
            </div>
            <div class="flex items-center justify-between">
              <dt class="text-muted-foreground">Elapsed</dt>
              <dd class="font-medium">
                {connector.activeSessionStartIso
                  ? formatSessionDuration(connector.activeSessionStartIso)
                  : "—"}
              </dd>
            </div>
            <div class="flex items-center justify-between">
              <dt class="text-muted-foreground">kWh</dt>
              <dd class="font-medium">
                {connector.activeSessionKwh !== null
                  ? connector.activeSessionKwh.toFixed(2)
                  : "—"}
              </dd>
            </div>
            {effectiveKw !== null && (
              <div class="col-span-2 flex items-center justify-between">
                <dt class="text-muted-foreground">Current power</dt>
                <dd class="flex items-center gap-1.5 font-medium">
                  {liveKw.value !== null && (
                    <span
                      aria-hidden="true"
                      class="relative flex size-1.5"
                    >
                      <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                      <span class="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
                    </span>
                  )}
                  <span class="tabular-nums">{effectiveKw.toFixed(2)} kW</span>
                </dd>
              </div>
            )}
          </dl>
        )
        : <div class="text-xs text-muted-foreground">No active session</div>}

      {isAdmin && (
        <div class="mt-auto flex flex-wrap gap-1.5 pt-2">
          {hasActiveSession
            ? (
              <Button
                size="sm"
                variant="destructive"
                onClick={() =>
                  launchAction("RemoteStopTransaction", {
                    transactionId: connector.activeTransactionId,
                  })}
              >
                <Square class="size-3.5" />
                Stop
              </Button>
            )
            : (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  launchAction("RemoteStartTransaction", {
                    connectorId: connector.connectorId,
                  })}
              >
                <Play class="size-3.5" />
                Start
              </Button>
            )}
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              launchAction("ReserveNow", {
                connectorId: connector.connectorId,
              })}
          >
            <Timer class="size-3.5" />
            Reserve
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              launchAction("ChangeAvailability", {
                connectorId: connector.connectorId,
              })}
          >
            <Ban class="size-3.5" />
            Availability
          </Button>
          <Button
            size="sm"
            variant="ghost"
            class="text-rose-600 hover:bg-rose-500/10 hover:text-rose-600 dark:text-rose-400 dark:hover:text-rose-400"
            onClick={() =>
              launchAction("UnlockConnector", {
                connectorId: connector.connectorId,
              })}
          >
            <Lock class="size-3.5" />
            Unlock
          </Button>
          {hasActiveSession && (
            <Badge variant="outline" class="text-[10px]">
              tx #{connector.activeTransactionId}
            </Badge>
          )}
        </div>
      )}

      {style.beam && (
        <BorderBeam
          size={160}
          duration={8}
          colorFrom={style.beam.from}
          colorTo={style.beam.to}
        />
      )}
    </div>
  );
}

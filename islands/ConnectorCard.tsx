/**
 * Per-connector card (island).
 *
 * Renders one connector's status pill, per-connector spec (type + kW)
 * with smart-edit affordances, optional active-session details, and the
 * admin actions appropriate for the charger's management mode.
 *
 * Managed (OCPP) chargers show Start / Stop / Reserve / Availability /
 * Unlock. Unmanaged chargers show only the spec editors and the Remove
 * affordance — there's no OCPP link to send commands over.
 */

import { useEffect, useState } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { Ban, Lock, Play, Square, Timer, X } from "lucide-preact";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { cn } from "@/src/lib/utils/cn.ts";
import { formatKw } from "@/src/lib/utils/format.ts";
import { BorderBeam } from "@/components/magicui/border-beam.tsx";
import { subscribeSse } from "@/islands/shared/SseProvider.tsx";
import { formatSessionDuration } from "./shared/device-visuals.ts";
import SmartSelectField from "./shared/SmartSelectField.tsx";
import {
  CONNECTOR_TYPE_LABELS,
  CONNECTOR_TYPES,
  KW_PRESETS,
} from "@/src/lib/types/connectors.ts";

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
  /** Per-connector spec from `charger_connectors`. */
  connectorType: string | null;
  maxKw: number | null;
}

interface Props {
  chargeBoxId: string;
  connector: ConnectorDto;
  isAdmin: boolean;
  /** Unmanaged chargers don't speak OCPP — hides Start / Stop / Reserve /
   *  Unlock. The spec editors and Remove button still render. */
  isUnmanaged: boolean;
}

interface StatusStyle {
  pillClass: string;
  dotClass: string;
  beam?: { from: string; to: string };
  dashed?: boolean;
}

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

function launchAction(
  operation: string,
  params: Record<string, unknown>,
) {
  const evt = new CustomEvent("charger:open-action", {
    detail: { operation, params },
  });
  globalThis.dispatchEvent(evt);
}

const CONNECTOR_TYPE_OPTIONS = CONNECTOR_TYPES.map((value) => ({
  value,
  label: CONNECTOR_TYPE_LABELS[value],
}));

const KW_OPTIONS = KW_PRESETS.map((p) => ({
  value: p.value.toString(),
  label: p.label,
}));

async function patchConnectorSpec(
  chargeBoxId: string,
  connectorId: number,
  patch: { connectorType?: string | null; maxKw?: number | null },
): Promise<void> {
  const res = await fetch(
    `/api/admin/charger/${chargeBoxId}/connectors/${connectorId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    },
  );
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error ?? `Save failed (HTTP ${res.status})`);
  }
}

export default function ConnectorCard(
  { chargeBoxId, connector, isAdmin, isUnmanaged }: Props,
) {
  const liveKw = useSignal<number | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

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

  const handleRemove = async () => {
    if (hasActiveSession) return;
    if (!confirm(`Remove connector ${connector.connectorId}?`)) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      const res = await fetch(
        `/api/admin/charger/${chargeBoxId}/connectors/${connector.connectorId}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.message ?? json.error ?? `HTTP ${res.status}`);
      }
      globalThis.location.reload();
    } catch (err) {
      setRemoveError(err instanceof Error ? err.message : String(err));
      setRemoving(false);
    }
  };

  return (
    <div
      class={cn(
        "relative flex flex-col gap-3 overflow-hidden rounded-xl border bg-card p-4",
        style.dashed && "border-dashed",
      )}
    >
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2 text-sm font-semibold">
          Connector {connector.connectorId}
          {isAdmin && (
            <button
              type="button"
              onClick={handleRemove}
              disabled={hasActiveSession || removing}
              title={hasActiveSession
                ? "Stop the active session before removing this connector"
                : "Remove this connector"}
              aria-label={`Remove connector ${connector.connectorId}`}
              class={cn(
                "inline-flex size-5 items-center justify-center rounded text-muted-foreground",
                "hover:bg-rose-500/10 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                (hasActiveSession || removing) &&
                  "cursor-not-allowed opacity-40 hover:bg-transparent hover:text-muted-foreground",
              )}
            >
              <X class="size-3.5" />
            </button>
          )}
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

      {/* Per-connector spec — type + kW. Smart-edit for admins. */}
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span>Type:</span>
        {isAdmin
          ? (
            <SmartSelectField
              value={connector.connectorType}
              options={CONNECTOR_TYPE_OPTIONS}
              ariaLabel="Edit connector type"
              onSave={async (next) => {
                await patchConnectorSpec(chargeBoxId, connector.connectorId, {
                  connectorType: next,
                });
                globalThis.location.reload();
              }}
              class="text-foreground"
            />
          )
          : (
            <span class="text-foreground">
              {connector.connectorType
                ? (CONNECTOR_TYPE_LABELS[
                  connector.connectorType as keyof typeof CONNECTOR_TYPE_LABELS
                ] ?? connector.connectorType)
                : "—"}
            </span>
          )}
        <span class="ml-2">Max:</span>
        {isAdmin
          ? (
            <SmartSelectField
              value={connector.maxKw !== null
                ? connector.maxKw.toString()
                : null}
              options={KW_OPTIONS}
              ariaLabel="Edit max kW"
              onSave={async (next) => {
                await patchConnectorSpec(chargeBoxId, connector.connectorId, {
                  maxKw: next !== null ? Number(next) : null,
                });
                globalThis.location.reload();
              }}
              class="text-foreground"
            />
          )
          : (
            <span class="text-foreground">
              {connector.maxKw !== null
                ? `${formatKw(connector.maxKw)} kW`
                : "—"}
            </span>
          )}
      </div>

      {removeError && (
        <div
          role="alert"
          class="rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-xs text-rose-700 dark:text-rose-300"
        >
          {removeError}
        </div>
      )}

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

      {hasActiveSession && (
        <dl class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <div class="col-span-2 flex items-center justify-between">
            <dt class="text-muted-foreground">EV Card</dt>
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
                  <span aria-hidden="true" class="relative flex size-1.5">
                    <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span class="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
                  </span>
                )}
                <span class="tabular-nums">{effectiveKw.toFixed(2)} kW</span>
              </dd>
            </div>
          )}
        </dl>
      )}

      {isAdmin && !isUnmanaged && (
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

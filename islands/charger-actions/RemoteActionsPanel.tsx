/**
 * Remote Actions Panel (Wave B4 split).
 *
 * Thin orchestrator that renders the tiles grid, dispatches to one of the
 * per-action dialog files, and surfaces the recent-operations strip. The
 * bulky per-op logic lives in sibling files in this folder.
 *
 * Gating / assumptions:
 *   - Admin-only — the route only mounts this component when the caller is
 *     an admin. No additional role check is performed here.
 *   - The prop shape matches the legacy `islands/RemoteActionsPanel.tsx` so
 *     the charger-detail page doesn't need any markup changes.
 *   - Destructive ops (Reset, ClearCache, UpdateFirmware, SendLocalList,
 *     ClearChargingProfile, ChangeConfiguration) are intentionally absent —
 *     route them through the StEvE admin UI instead.
 */

import { useEffect, useState } from "preact/hooks";
import type { LucideIcon } from "lucide-preact";
import {
  Ban,
  BellRing,
  Download,
  FileText,
  Hash,
  ListOrdered,
  Lock,
  Play,
  Send,
  Square,
  Timer,
  TimerOff,
  Zap,
} from "lucide-preact";
import type { OcppOperationName } from "@/src/lib/types/steve.ts";
import type { OperationResult, PanelProps, PerDialogProps } from "./types.ts";
import { ActionTile } from "./ActionTile.tsx";
import RecentOperationsStrip from "./RecentOperationsStrip.tsx";

import RemoteStartDialog from "./RemoteStartDialog.tsx";
import RemoteStopDialog from "./RemoteStopDialog.tsx";
import UnlockConnectorDialog from "./UnlockConnectorDialog.tsx";
import ReserveNowDialog from "./ReserveNowDialog.tsx";
import CancelReservationDialog from "./CancelReservationDialog.tsx";
import ChangeAvailabilityDialog from "./ChangeAvailabilityDialog.tsx";
import TriggerMessageDialog from "./TriggerMessageDialog.tsx";
import GetConfigurationDialog from "./GetConfigurationDialog.tsx";
import GetCompositeScheduleDialog from "./GetCompositeScheduleDialog.tsx";
import GetDiagnosticsDialog from "./GetDiagnosticsDialog.tsx";
import GetLocalListVersionDialog from "./GetLocalListVersionDialog.tsx";
import DataTransferDialog from "./DataTransferDialog.tsx";
import SetChargingProfileDialog from "./SetChargingProfileDialog.tsx";

interface TileSpec {
  op: OcppOperationName;
  icon: LucideIcon;
  label: string;
  description: string;
  accent?: "default" | "destructive";
}

const PRIMARY_TILES: TileSpec[] = [
  {
    op: "RemoteStartTransaction",
    icon: Play,
    label: "Start transaction",
    description: "Begin charging under a chosen OCPP tag.",
  },
  {
    op: "RemoteStopTransaction",
    icon: Square,
    label: "Stop transaction",
    description: "End the active charging session.",
    accent: "destructive",
  },
  {
    op: "UnlockConnector",
    icon: Lock,
    label: "Unlock connector",
    description: "Physically release a stuck cable.",
    accent: "destructive",
  },
  {
    op: "ReserveNow",
    icon: Timer,
    label: "Reserve connector",
    description: "Hold the connector for a specific tag.",
  },
  {
    op: "CancelReservation",
    icon: TimerOff,
    label: "Cancel reservation",
    description: "Release an existing reservation.",
  },
  {
    op: "ChangeAvailability",
    icon: Ban,
    label: "Change availability",
    description: "Mark the charger Operative or Inoperative.",
  },
  {
    op: "TriggerMessage",
    icon: BellRing,
    label: "Trigger message",
    description: "Force an OCPP message (e.g. StatusNotification).",
  },
  {
    op: "GetConfiguration",
    icon: FileText,
    label: "Get configuration",
    description: "Fetch configuration keys from the charger.",
  },
];

const SECONDARY_TILES: TileSpec[] = [
  {
    op: "GetCompositeSchedule",
    icon: ListOrdered,
    label: "Get composite schedule",
    description: "Retrieve the active charging schedule.",
  },
  {
    op: "GetDiagnostics",
    icon: Download,
    label: "Get diagnostics",
    description: "Upload a diagnostics bundle to a URL.",
  },
  {
    op: "GetLocalListVersion",
    icon: Hash,
    label: "Get local list version",
    description: "Show the cached authorization list version.",
  },
  {
    op: "DataTransfer",
    icon: Send,
    label: "Data transfer",
    description: "OEM-specific vendor payload.",
    accent: "destructive",
  },
  {
    op: "SetChargingProfile",
    icon: Zap,
    label: "Set charging profile",
    description: "Apply a stored TxDefault/TxProfile.",
    accent: "destructive",
  },
];

// Partial: not every `OcppOperationName` has a confirm dialog wired up
// yet (e.g. `ChangeConfiguration` is only reachable via the StEvE UI
// today). Operations without an entry here fall through to the fallback
// branch in the action grid below — no dialog, no submit.
const DIALOG_COMPONENTS: Partial<
  Record<OcppOperationName, (p: PerDialogProps) => preact.JSX.Element>
> = {
  RemoteStartTransaction: RemoteStartDialog,
  RemoteStopTransaction: RemoteStopDialog,
  UnlockConnector: UnlockConnectorDialog,
  ReserveNow: ReserveNowDialog,
  CancelReservation: CancelReservationDialog,
  ChangeAvailability: ChangeAvailabilityDialog,
  TriggerMessage: TriggerMessageDialog,
  GetConfiguration: GetConfigurationDialog,
  GetCompositeSchedule: GetCompositeScheduleDialog,
  GetDiagnostics: GetDiagnosticsDialog,
  GetLocalListVersion: GetLocalListVersionDialog,
  DataTransfer: DataTransferDialog,
  SetChargingProfile: SetChargingProfileDialog,
};

export default function RemoteActionsPanel(
  { chargeBoxId, friendlyName = null, activeSessions = [] }: PanelProps,
) {
  const [activeOp, setActiveOp] = useState<OcppOperationName | null>(null);
  const [prefill, setPrefill] = useState<Record<string, unknown>>({});
  const [lastResult, setLastResult] = useState<OperationResult | null>(null);
  const [bump, setBump] = useState(0);

  // Keep the cross-island event (from ConnectorCard quick-actions) working
  // so per-connector buttons still open the right dialog with prefill.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        operation: OcppOperationName;
        params: Record<string, unknown>;
      };
      setPrefill(detail.params ?? {});
      setActiveOp(detail.operation);
    };
    globalThis.addEventListener("charger:open-action", handler);
    return () => globalThis.removeEventListener("charger:open-action", handler);
  }, []);

  const openDialog = (op: OcppOperationName) => {
    setPrefill({});
    setActiveOp(op);
  };

  const hasActiveSession = activeSessions.length > 0;

  // Disabled-state rules — compute from live props. `null` = enabled.
  const disabledReason = (op: OcppOperationName): string | null => {
    switch (op) {
      case "RemoteStartTransaction":
        if (hasActiveSession) return "Charger already has an active session";
        return null;
      case "RemoteStopTransaction":
        if (!hasActiveSession) return "No active charging session";
        return null;
      case "ReserveNow":
        // Offline/reserved state is not visible here — props don't carry raw
        // uiStatus. Left enabled; server returns a clear error if rejected.
        return null;
      default:
        return null;
    }
  };

  const onResult = (r: OperationResult) => {
    setLastResult(r);
    setBump((b) => b + 1);
  };

  const ActiveDialog = activeOp ? DIALOG_COMPONENTS[activeOp] : null;

  return (
    <section
      aria-label="Remote actions"
      class="flex flex-col gap-4 rounded-xl border bg-card p-5"
    >
      <div class="flex flex-col gap-1">
        <h2 class="text-sm font-semibold">Remote actions</h2>
        <p class="text-xs text-muted-foreground">
          Admin-only. Destructive ops (Reset, ClearCache, UpdateFirmware,
          SendLocalList, ClearChargingProfile, ChangeConfiguration) are
          intentionally absent — use the StEvE admin UI for those.
        </p>
      </div>

      <RecentOperationsStrip chargeBoxId={chargeBoxId} bump={bump} />

      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {PRIMARY_TILES.map((t) => {
          const reason = disabledReason(t.op);
          return (
            <ActionTile
              key={t.op}
              icon={t.icon}
              label={t.label}
              description={t.description}
              accent={t.accent}
              disabled={Boolean(reason)}
              disabledReason={reason ?? undefined}
              onClick={() => openDialog(t.op)}
            />
          );
        })}
      </div>

      <details class="flex flex-col gap-2">
        <summary class="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
          More actions
        </summary>
        <div class="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {SECONDARY_TILES.map((t) => {
            const reason = disabledReason(t.op);
            return (
              <ActionTile
                key={t.op}
                icon={t.icon}
                label={t.label}
                description={t.description}
                accent={t.accent}
                disabled={Boolean(reason)}
                disabledReason={reason ?? undefined}
                onClick={() => openDialog(t.op)}
              />
            );
          })}
        </div>
      </details>

      {lastResult && (
        <div class="rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">
          Submitted {lastResult.operation}{" "}
          (audit #{lastResult.operationLogId}). Watch the strip above for
          status.
        </div>
      )}

      {ActiveDialog && activeOp && (
        <ActiveDialog
          key={`${activeOp}-${JSON.stringify(prefill)}`}
          chargeBoxId={chargeBoxId}
          friendlyName={friendlyName}
          activeSessions={activeSessions}
          prefill={prefill}
          isOpen
          onClose={() => setActiveOp(null)}
          onResult={onResult}
        />
      )}
    </section>
  );
}

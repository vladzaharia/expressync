/**
 * Remote Actions Panel (island) — admin-only.
 *
 * Renders a 3-col button grid for the 8 primary OCPP operations plus a
 * `More actions…` dropdown for the rest. Each button opens a parameterized
 * `<Dialog>` whose fields are driven by the Zod schema shape pulled from
 * `OPERATION_PARAM_SCHEMAS`. On submit we POST `/api/charger/operation` and
 * render an inline result card that polls
 * `GET /api/charger/operation/[operationLogId]` until terminal.
 *
 * Safety features the plan requires:
 *   - `chargeBoxId` field is pre-filled and read-only.
 *   - Dry-run toggle at the top of every dialog.
 *   - Confirm-then-run gating for destructive ops.
 *   - Default focus in destructive dialogs lands on the safe (Cancel) button.
 *   - Destructive button labels are explicit ("Unlock connector", not
 *     "Confirm").
 */

import { useEffect, useState } from "preact/hooks";
import type { LucideIcon } from "lucide-preact";
import {
  Ban,
  BellRing,
  ChevronDown,
  Download,
  FileText,
  Hash,
  ListOrdered,
  Loader2,
  Lock,
  Play,
  Send,
  Square,
  Timer,
  TimerOff,
  Wrench,
  Zap,
} from "lucide-preact";
import { Button } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.tsx";
import { cn } from "@/src/lib/utils/cn.ts";
import type { OcppOperationName } from "@/src/lib/types/steve.ts";

// ---------------------------------------------------------------------------
// Field schema — keep out of Zod to avoid dragging it into the browser bundle.
// This is a tiny declarative mirror of OPERATION_PARAM_SCHEMAS; the server is
// the authoritative validator.
// ---------------------------------------------------------------------------

type FieldType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "datetime"
  | "textarea"
  | "select";

interface FieldSpec {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: { value: string; label: string }[];
  placeholder?: string;
  help?: string;
  min?: number;
  /** If true, auto-filled from `chargeBoxId` or a connector context and rendered
   *  read-only. */
  readOnly?: boolean;
}

interface OpSpec {
  icon: LucideIcon;
  label: string;
  description: string;
  fields: FieldSpec[];
  /** When true, default focus in the dialog lands on Cancel and the primary
   *  button renders with the destructive variant. */
  destructive?: boolean;
  /** Explicit primary-button label ("Unlock connector" rather than "Submit"). */
  primaryLabel?: string;
  /** Simple name of a field that, when matching a given value, should flip the
   *  dialog into confirmation mode. Used for ChangeAvailability=Inoperative. */
  confirmWhen?: { field: string; equals: unknown };
  /** Require the user to type a literal string into a confirmation input
   *  before the primary button is enabled. Used for DataTransfer. */
  typeConfirmPhrase?: string;
  /** A pending-young-session warning (RemoteStopTransaction). */
  warnIfRecent?: boolean;
}

const OP_CATALOG: Record<OcppOperationName, OpSpec> = {
  RemoteStartTransaction: {
    icon: Play,
    label: "Start transaction",
    description:
      "Send a RemoteStartTransaction so the charger begins charging under the supplied OCPP tag.",
    fields: [
      {
        key: "chargeBoxId",
        label: "Charge box ID",
        type: "string",
        readOnly: true,
      },
      {
        key: "connectorId",
        label: "Connector (0 = charger-wide)",
        type: "integer",
        min: 0,
      },
      { key: "idTag", label: "OCPP ID tag", type: "string", required: true },
      {
        key: "chargingProfilePk",
        label: "Charging profile PK (optional)",
        type: "integer",
        min: 1,
      },
    ],
  },
  RemoteStopTransaction: {
    icon: Square,
    label: "Stop transaction",
    description:
      "Send a RemoteStopTransaction for the given live transaction ID.",
    fields: [
      {
        key: "chargeBoxId",
        label: "Charge box ID",
        type: "string",
        readOnly: true,
      },
      {
        key: "transactionId",
        label: "Transaction ID",
        type: "integer",
        required: true,
      },
    ],
    destructive: true,
    primaryLabel: "Stop transaction",
    warnIfRecent: true,
  },
  UnlockConnector: {
    icon: Lock,
    label: "Unlock connector",
    description:
      "Physically releases the cable. Use when a customer can't detach after a completed session.",
    fields: [
      {
        key: "chargeBoxId",
        label: "Charge box ID",
        type: "string",
        readOnly: true,
      },
      {
        key: "connectorId",
        label: "Connector",
        type: "integer",
        required: true,
        min: 1,
      },
    ],
    destructive: true,
    primaryLabel: "Unlock connector",
  },
  ReserveNow: {
    icon: Timer,
    label: "Reserve connector",
    description:
      "Reserve a connector for a specific idTag until a future time.",
    fields: [
      {
        key: "chargeBoxId",
        label: "Charge box ID",
        type: "string",
        readOnly: true,
      },
      {
        key: "connectorId",
        label: "Connector (0 = any)",
        type: "integer",
        required: true,
        min: 0,
      },
      {
        key: "expiry",
        label: "Expires at (ISO8601)",
        type: "datetime",
        required: true,
      },
      { key: "idTag", label: "OCPP ID tag", type: "string", required: true },
    ],
    primaryLabel: "Reserve",
  },
  CancelReservation: {
    icon: TimerOff,
    label: "Cancel reservation",
    description: "Cancels an existing reservation by its reservation ID.",
    fields: [
      {
        key: "chargeBoxId",
        label: "Charge box ID",
        type: "string",
        readOnly: true,
      },
      {
        key: "reservationId",
        label: "Reservation ID",
        type: "integer",
        required: true,
        min: 0,
      },
    ],
    primaryLabel: "Cancel reservation",
  },
  ChangeAvailability: {
    icon: Ban,
    label: "Change availability",
    description:
      "Put the charge point (or one connector) Operative or Inoperative.",
    fields: [
      {
        key: "chargeBoxId",
        label: "Charge box ID",
        type: "string",
        readOnly: true,
      },
      {
        key: "connectorId",
        label: "Connector (0 = whole charger)",
        type: "integer",
        min: 0,
      },
      {
        key: "availType",
        label: "Availability",
        type: "select",
        required: true,
        options: [
          { value: "Operative", label: "Operative" },
          { value: "Inoperative", label: "Inoperative" },
        ],
      },
    ],
    confirmWhen: { field: "availType", equals: "Inoperative" },
    primaryLabel: "Apply availability",
  },
  TriggerMessage: {
    icon: BellRing,
    label: "Trigger message",
    description:
      "Ask the charger to send one specific OCPP message now (e.g. StatusNotification).",
    fields: [
      {
        key: "chargeBoxId",
        label: "Charge box ID",
        type: "string",
        readOnly: true,
      },
      {
        key: "triggerMessage",
        label: "Message",
        type: "select",
        required: true,
        options: [
          { value: "StatusNotification", label: "StatusNotification" },
          { value: "Heartbeat", label: "Heartbeat" },
          { value: "MeterValues", label: "MeterValues" },
          { value: "BootNotification", label: "BootNotification" },
          {
            value: "DiagnosticsStatusNotification",
            label: "DiagnosticsStatusNotification",
          },
          {
            value: "FirmwareStatusNotification",
            label: "FirmwareStatusNotification",
          },
        ],
      },
      {
        key: "connectorId",
        label: "Connector (optional)",
        type: "integer",
        min: 1,
      },
    ],
    primaryLabel: "Trigger",
  },
  GetConfiguration: {
    icon: FileText,
    label: "Get configuration",
    description:
      "Fetch configuration keys. Leave custom keys blank to retrieve everything.",
    fields: [
      {
        key: "chargeBoxId",
        label: "Charge box ID",
        type: "string",
        readOnly: true,
      },
      {
        key: "commaSeparatedCustomConfKeys",
        label: "Custom keys (comma-separated)",
        type: "string",
      },
    ],
    primaryLabel: "Get configuration",
  },
  GetCompositeSchedule: {
    icon: ListOrdered,
    label: "Get composite schedule",
    description: "Retrieve the currently active charging schedule.",
    fields: [
      {
        key: "chargeBoxId",
        label: "Charge box ID",
        type: "string",
        readOnly: true,
      },
      {
        key: "connectorId",
        label: "Connector",
        type: "integer",
        required: true,
        min: 0,
      },
      {
        key: "durationInSeconds",
        label: "Duration (s)",
        type: "integer",
        required: true,
        min: 1,
      },
      {
        key: "chargingRateUnit",
        label: "Rate unit",
        type: "select",
        options: [
          { value: "A", label: "Amps (A)" },
          { value: "W", label: "Watts (W)" },
        ],
      },
    ],
    primaryLabel: "Get schedule",
  },
  GetDiagnostics: {
    icon: Download,
    label: "Get diagnostics",
    description:
      "Ask the charger to upload a diagnostics bundle to the given URL.",
    fields: [
      {
        key: "chargeBoxId",
        label: "Charge box ID",
        type: "string",
        readOnly: true,
      },
      {
        key: "location",
        label: "Upload URL",
        type: "string",
        required: true,
        placeholder: "ftp://…",
      },
      { key: "retries", label: "Retries", type: "integer", min: 1 },
      {
        key: "retryInterval",
        label: "Retry interval (s)",
        type: "integer",
        min: 1,
      },
      { key: "start", label: "Start (ISO, optional)", type: "datetime" },
      { key: "stop", label: "Stop (ISO, optional)", type: "datetime" },
    ],
    primaryLabel: "Request diagnostics",
  },
  GetLocalListVersion: {
    icon: Hash,
    label: "Get local list version",
    description:
      "Returns the charger's currently cached local authorization list version.",
    fields: [
      {
        key: "chargeBoxId",
        label: "Charge box ID",
        type: "string",
        readOnly: true,
      },
    ],
    primaryLabel: "Get version",
  },
  DataTransfer: {
    icon: Send,
    label: "Data transfer",
    description:
      "OEM-specific DataTransfer. Type DATA TRANSFER below to confirm because vendor semantics vary.",
    fields: [
      {
        key: "chargeBoxId",
        label: "Charge box ID",
        type: "string",
        readOnly: true,
      },
      { key: "vendorId", label: "Vendor ID", type: "string", required: true },
      { key: "messageId", label: "Message ID (optional)", type: "string" },
      { key: "data", label: "Payload", type: "textarea" },
    ],
    destructive: true,
    primaryLabel: "Send data transfer",
    typeConfirmPhrase: "DATA TRANSFER",
  },
  SetChargingProfile: {
    icon: Zap,
    label: "Set charging profile",
    description: "Apply a stored TxDefault/TxProfile to this connector.",
    fields: [
      {
        key: "chargeBoxId",
        label: "Charge box ID",
        type: "string",
        readOnly: true,
      },
      {
        key: "connectorId",
        label: "Connector",
        type: "integer",
        required: true,
        min: 0,
      },
      {
        key: "chargingProfilePk",
        label: "Charging profile PK",
        type: "integer",
        required: true,
        min: 1,
      },
      {
        key: "transactionId",
        label: "Transaction ID (optional)",
        type: "integer",
        min: 1,
      },
    ],
    destructive: true,
    primaryLabel: "Apply profile",
  },
};

const PRIMARY_OPS: OcppOperationName[] = [
  "RemoteStartTransaction",
  "RemoteStopTransaction",
  "UnlockConnector",
  "ReserveNow",
  "CancelReservation",
  "ChangeAvailability",
  "TriggerMessage",
  "GetConfiguration",
];

const MORE_OPS: OcppOperationName[] = [
  "GetCompositeSchedule",
  "GetDiagnostics",
  "GetLocalListVersion",
  "DataTransfer",
  "SetChargingProfile",
];

// ---------------------------------------------------------------------------
// Dialog + result shapes
// ---------------------------------------------------------------------------

interface OperationResult {
  operationLogId: number;
  taskId: number | null;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
  error: string | null;
  pollAttempts: number;
  result: Record<string, unknown> | null;
  operation: OcppOperationName;
}

interface ActiveSessionContext {
  connectorId: number;
  transactionId: number;
  startTimestampIso: string;
}

interface Props {
  chargeBoxId: string;
  activeSessions?: ActiveSessionContext[];
  steveBaseUrl?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function initialFormFor(
  op: OcppOperationName,
  chargeBoxId: string,
  prefill: Record<string, unknown>,
): Record<string, string> {
  const spec = OP_CATALOG[op];
  const out: Record<string, string> = {};
  for (const f of spec.fields) {
    if (f.key === "chargeBoxId") {
      out[f.key] = chargeBoxId;
      continue;
    }
    if (
      f.key in prefill && prefill[f.key] !== undefined &&
      prefill[f.key] !== null
    ) {
      out[f.key] = String(prefill[f.key]);
      continue;
    }
    out[f.key] = "";
  }
  return out;
}

function coerceParams(
  op: OcppOperationName,
  formValues: Record<string, string>,
): Record<string, unknown> {
  const spec = OP_CATALOG[op];
  const out: Record<string, unknown> = {};
  for (const f of spec.fields) {
    const raw = formValues[f.key]?.trim();
    if (!raw) continue;
    switch (f.type) {
      case "integer":
      case "number": {
        const n = Number(raw);
        if (!Number.isNaN(n)) out[f.key] = n;
        break;
      }
      case "boolean":
        out[f.key] = raw === "true";
        break;
      default:
        out[f.key] = raw;
    }
  }
  return out;
}

const TERMINAL_STATUSES = new Set([
  "success",
  "failed",
  "timeout",
  "dry_run",
  "completed",
]);

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function RemoteActionsPanel(
  { chargeBoxId, activeSessions = [] }: Props,
) {
  const [activeOp, setActiveOp] = useState<OcppOperationName | null>(null);
  const [prefill, setPrefill] = useState<Record<string, unknown>>({});
  const [lastResult, setLastResult] = useState<OperationResult | null>(null);

  // Listen for events dispatched by `ConnectorCard` so per-connector quick
  // actions open the same dialogs with connectorId prefilled.
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

  return (
    <section
      aria-label="Remote actions"
      class="flex flex-col gap-4 rounded-xl border bg-card p-5"
    >
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 class="text-sm font-semibold">Remote actions</h2>
          <p class="text-xs text-muted-foreground">
            Admin-only. Destructive ops (Reset, ClearCache, UpdateFirmware,
            SendLocalList, ClearChargingProfile, ChangeConfiguration) are
            intentionally absent — use the StEvE admin UI for those.
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              More actions
              <ChevronDown class="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {MORE_OPS.map((op) => {
              const Icon = OP_CATALOG[op].icon;
              return (
                <DropdownMenuItem key={op} onClick={() => openDialog(op)}>
                  <Icon class="size-4" />
                  {OP_CATALOG[op].label}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
        {PRIMARY_OPS.map((op) => {
          const spec = OP_CATALOG[op];
          const Icon = spec.icon;
          return (
            <Button
              key={op}
              variant="outline"
              size="sm"
              class={cn(
                "justify-start",
                spec.destructive &&
                  "text-rose-600 dark:text-rose-400 hover:bg-rose-500/10",
              )}
              onClick={() => openDialog(op)}
            >
              <Icon class="size-4" />
              {spec.label}
            </Button>
          );
        })}
      </div>

      {lastResult && (
        <OperationResultCard
          result={lastResult}
          onClear={() => setLastResult(null)}
        />
      )}

      {activeOp && (
        <OperationDialog
          key={activeOp + JSON.stringify(prefill)}
          op={activeOp}
          chargeBoxId={chargeBoxId}
          prefill={prefill}
          activeSessions={activeSessions}
          onClose={() => setActiveOp(null)}
          onResult={(r) => setLastResult(r)}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// OperationDialog
// ---------------------------------------------------------------------------

function OperationDialog({
  op,
  chargeBoxId,
  prefill,
  activeSessions,
  onClose,
  onResult,
}: {
  op: OcppOperationName;
  chargeBoxId: string;
  prefill: Record<string, unknown>;
  activeSessions: ActiveSessionContext[];
  onClose: () => void;
  onResult: (result: OperationResult) => void;
}) {
  const spec = OP_CATALOG[op];
  const [form, setForm] = useState<Record<string, string>>(() =>
    initialFormFor(op, chargeBoxId, prefill)
  );
  const [dryRun, setDryRun] = useState(false);
  const [confirmPhrase, setConfirmPhrase] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelBtnId = `cancel-${op}`;

  // Focus the Cancel button for destructive ops so ENTER does not fire the
  // destructive primary action by accident (a11y requirement). We use
  // document.getElementById because the Button component doesn't forward a
  // ref we can reliably attach to an underlying DOM node.
  useEffect(() => {
    if (!spec.destructive) return;
    // Let the dialog's own mount/animate cycle settle first.
    const t = setTimeout(() => {
      const el = document.getElementById(cancelBtnId);
      if (el instanceof HTMLElement) el.focus();
    }, 50);
    return () => clearTimeout(t);
  }, [spec.destructive, cancelBtnId]);

  const setField = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const inConfirmMode = spec.confirmWhen
    ? form[spec.confirmWhen.field] === String(spec.confirmWhen.equals)
    : false;

  const needsTypeConfirm = Boolean(spec.typeConfirmPhrase);
  const typeConfirmOk = spec.typeConfirmPhrase
    ? confirmPhrase.trim() === spec.typeConfirmPhrase
    : true;

  // Warn if we're trying to stop a session younger than 60 s.
  const recentSessionWarning = (() => {
    if (!spec.warnIfRecent) return null;
    const txId = Number(form.transactionId);
    if (!Number.isFinite(txId)) return null;
    const session = activeSessions.find((s) => s.transactionId === txId);
    if (!session) return null;
    const ageMs = Date.now() - new Date(session.startTimestampIso).getTime();
    if (ageMs < 60_000) {
      return `Transaction #${txId} started ${
        Math.round(ageMs / 1000)
      }s ago — are you sure?`;
    }
    return null;
  })();

  const canSubmit = !submitting && typeConfirmOk;

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    const startedAt = new Date();
    try {
      const params = coerceParams(op, form);
      // Strip chargeBoxId from params — server injects it from its own field.
      delete (params as Record<string, unknown>).chargeBoxId;

      const res = await fetch("/api/charger/operation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chargeBoxId,
          operation: op,
          params,
          dryRun,
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          json.error ?? `Operation failed (HTTP ${res.status})`,
        );
      }

      const result: OperationResult = {
        operationLogId: json.operationLogId,
        taskId: json.taskId ?? null,
        status: json.status ?? "submitted",
        startedAt,
        completedAt: dryRun || TERMINAL_STATUSES.has(json.status)
          ? new Date()
          : null,
        error: null,
        pollAttempts: 0,
        result: null,
        operation: op,
      };
      onResult(result);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const PrimaryIcon = spec.icon;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent onClose={onClose} class="max-w-xl">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2">
            <PrimaryIcon class="size-5" />
            {spec.label}
          </DialogTitle>
          <DialogDescription>{spec.description}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} class="flex flex-col gap-4">
          {/* Dry-run toggle */}
          <label class="flex items-start gap-2 rounded-md border bg-muted/30 p-2 text-xs">
            <Checkbox
              id={`dryrun-${op}`}
              checked={dryRun}
              onCheckedChange={(v) => setDryRun(Boolean(v))}
            />
            <div class="flex flex-col gap-0.5">
              <span class="font-medium">Dry run</span>
              <span class="text-muted-foreground">
                Records an audit entry without calling StEvE. Useful for
                rehearsing destructive ops.
              </span>
            </div>
          </label>

          <div class="grid grid-cols-1 gap-3">
            {spec.fields.map((f) => (
              <FieldRow
                key={f.key}
                field={f}
                value={form[f.key] ?? ""}
                onChange={(v) => setField(f.key, v)}
              />
            ))}
          </div>

          {recentSessionWarning && (
            <div
              role="alert"
              class="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300"
            >
              {recentSessionWarning}
            </div>
          )}

          {inConfirmMode && (
            <div
              role="alert"
              class="rounded-md border border-rose-500/40 bg-rose-500/10 p-2 text-xs text-rose-700 dark:text-rose-300"
            >
              This will take the charger (or connector) out of service for new
              sessions. Existing sessions keep running until they end.
            </div>
          )}

          {needsTypeConfirm && (
            <div class="flex flex-col gap-1">
              <Label for={`confirm-${op}`} class="text-xs">
                Type <code class="font-mono">{spec.typeConfirmPhrase}</code>
                {" "}
                to confirm
              </Label>
              <Input
                id={`confirm-${op}`}
                value={confirmPhrase}
                onInput={(e) =>
                  setConfirmPhrase((e.currentTarget as HTMLInputElement).value)}
              />
            </div>
          )}

          {error && (
            <div
              role="alert"
              class="rounded-md border border-rose-500/40 bg-rose-500/10 p-2 text-xs text-rose-700 dark:text-rose-300"
            >
              {error}
            </div>
          )}

          <DialogFooter>
            <Button
              id={cancelBtnId}
              type="button"
              variant="outline"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant={spec.destructive ? "destructive" : "default"}
              disabled={!canSubmit}
            >
              {submitting
                ? <Loader2 class="size-4 animate-spin" />
                : <PrimaryIcon class="size-4" />}
              {dryRun
                ? `Run dry ${spec.primaryLabel ?? spec.label}`
                : (spec.primaryLabel ?? spec.label)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// FieldRow
// ---------------------------------------------------------------------------

function FieldRow(
  { field, value, onChange }: {
    field: FieldSpec;
    value: string;
    onChange: (next: string) => void;
  },
) {
  const id = `field-${field.key}`;

  if (field.type === "select" && field.options) {
    return (
      <div class="flex flex-col gap-1">
        <Label for={id} class="text-xs">{field.label}</Label>
        <Select
          value={value}
          onValueChange={(v: string) => onChange(v)}
          disabled={field.readOnly}
        >
          <SelectTrigger id={id}>
            <SelectValue placeholder="Choose…" />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {field.help && (
          <p class="text-[11px] text-muted-foreground">{field.help}</p>
        )}
      </div>
    );
  }

  if (field.type === "textarea") {
    return (
      <div class="flex flex-col gap-1">
        <Label for={id} class="text-xs">{field.label}</Label>
        <textarea
          id={id}
          class="min-h-[72px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={value}
          readOnly={field.readOnly}
          placeholder={field.placeholder}
          onInput={(e) =>
            onChange((e.currentTarget as HTMLTextAreaElement).value)}
        />
        {field.help && (
          <p class="text-[11px] text-muted-foreground">{field.help}</p>
        )}
      </div>
    );
  }

  const inputType = field.type === "integer" || field.type === "number"
    ? "number"
    : field.type === "datetime"
    ? "datetime-local"
    : "text";

  return (
    <div class="flex flex-col gap-1">
      <Label for={id} class="text-xs">{field.label}</Label>
      <Input
        id={id}
        type={inputType}
        value={value}
        readOnly={field.readOnly}
        placeholder={field.placeholder}
        min={field.min}
        onInput={(e) => onChange((e.currentTarget as HTMLInputElement).value)}
        class={field.readOnly ? "bg-muted font-mono text-xs" : undefined}
      />
      {field.help && (
        <p class="text-[11px] text-muted-foreground">{field.help}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// OperationResultCard — inline (not toast), polls until terminal.
// ---------------------------------------------------------------------------

function OperationResultCard(
  { result, onClear }: { result: OperationResult; onClear: () => void },
) {
  const [state, setState] = useState<OperationResult>(result);

  useEffect(() => {
    setState(result);
  }, [result.operationLogId]);

  useEffect(() => {
    if (TERMINAL_STATUSES.has(state.status)) return;
    let cancelled = false;
    let delayMs = 2000;
    const deadline = state.startedAt.getTime() + 60_000;

    const tick = async () => {
      if (cancelled) return;
      if (Date.now() > deadline) {
        setState((s) => ({ ...s, status: "timeout", completedAt: new Date() }));
        return;
      }
      try {
        const res = await fetch(
          `/api/charger/operation/${state.operationLogId}`,
        );
        if (res.ok) {
          const json = await res.json();
          setState((s) => ({
            ...s,
            status: json.status ?? s.status,
            taskId: json.taskId ?? s.taskId,
            result: json.result ?? s.result,
            completedAt: json.completedAt
              ? new Date(json.completedAt)
              : s.completedAt,
            pollAttempts: s.pollAttempts + 1,
          }));
          if (TERMINAL_STATUSES.has(json.status)) {
            return;
          }
        }
      } catch {
        // swallow — we'll back off below
      }
      delayMs = Math.min(delayMs * 1.5, 10_000);
      if (!cancelled) {
        setTimeout(tick, delayMs);
      }
    };

    const first = setTimeout(tick, delayMs);
    return () => {
      cancelled = true;
      clearTimeout(first);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.operationLogId]);

  const terminal = TERMINAL_STATUSES.has(state.status);

  return (
    <div
      role="status"
      aria-live="polite"
      class={cn(
        "flex flex-col gap-2 rounded-lg border p-3 text-sm",
        state.status === "success" || state.status === "completed"
          ? "border-emerald-500/40 bg-emerald-500/10"
          : state.status === "failed" || state.status === "timeout"
          ? "border-rose-500/40 bg-rose-500/10"
          : state.status === "dry_run"
          ? "border-sky-500/40 bg-sky-500/10"
          : "border-amber-500/40 bg-amber-500/10",
      )}
    >
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <OpStatusIcon status={state.status} />
          <span class="font-semibold">
            {state.operation} — {state.status}
          </span>
          {state.taskId !== null && (
            <Badge variant="outline" class="font-mono text-[11px]">
              task {state.taskId}
            </Badge>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={onClear}>
          Dismiss
        </Button>
      </div>
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>audit #{state.operationLogId}</span>
        <span>started {state.startedAt.toLocaleTimeString()}</span>
        {state.completedAt && (
          <span>
            completed {state.completedAt.toLocaleTimeString()}
          </span>
        )}
        {!terminal && <span>polling… attempt {state.pollAttempts + 1}</span>}
      </div>
      {state.result && (
        <details class="text-xs">
          <summary class="cursor-pointer text-muted-foreground">
            Raw result
          </summary>
          <pre class="mt-1 max-h-48 overflow-auto rounded bg-background/50 p-2 font-mono text-[11px]">
            {JSON.stringify(state.result, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

function OpStatusIcon({ status }: { status: string }) {
  if (status === "pending" || status === "submitted") {
    return <Loader2 class="size-4 animate-spin" />;
  }
  if (status === "failed" || status === "timeout") {
    return <Wrench class="size-4" />;
  }
  if (status === "dry_run") {
    return <FileText class="size-4" />;
  }
  return <BellRing class="size-4" />;
}

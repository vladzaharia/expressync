/**
 * Shared types for the Remote Actions panel + per-action dialogs.
 *
 * Per-op connectorId handling (payload only; field hidden in UI):
 *   RemoteStart / ReserveNow / TriggerMessage / GetCompositeSchedule / SetChargingProfile → auto-fill 1
 *   UnlockConnector → auto-fill 1 (spec min=1, single-connector deployment)
 *   ChangeAvailability → auto-fill 0 (whole charger; Inoperative requires explicit destructive confirm)
 *   RemoteStop / CancelReservation / GetConfiguration / GetDiagnostics / GetLocalListVersion / DataTransfer → NO connector field at all
 */

import type { OcppOperationName } from "@/src/lib/types/steve.ts";

export interface ActiveSessionContext {
  connectorId: number;
  transactionId: number;
  startTimestampIso: string;
}

export interface PanelProps {
  chargeBoxId: string;
  activeSessions?: ActiveSessionContext[];
  steveBaseUrl?: string;
}

export interface PerDialogProps {
  chargeBoxId: string;
  activeSessions: ActiveSessionContext[];
  prefill: Record<string, unknown>;
  isOpen: boolean;
  onClose: () => void;
  onResult: (result: OperationResult) => void;
}

export interface OperationResult {
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

export const TERMINAL_STATUSES = new Set([
  "success",
  "failed",
  "timeout",
  "dry_run",
  "completed",
]);

/**
 * Connector injection mapping. Used by each per-action dialog right before
 * POSTing to /api/charger/operation. `null` means don't send a connectorId.
 * See header comment above for rationale.
 */
export const CONNECTOR_INJECTION: Partial<Record<OcppOperationName, number>> = {
  RemoteStartTransaction: 1,
  ReserveNow: 1,
  TriggerMessage: 1,
  GetCompositeSchedule: 1,
  SetChargingProfile: 1,
  UnlockConnector: 1,
  ChangeAvailability: 0,
  // omitted (no connector field at all):
  //   RemoteStopTransaction, CancelReservation, GetConfiguration,
  //   GetDiagnostics, GetLocalListVersion, DataTransfer
};

export async function submitOperation(args: {
  chargeBoxId: string;
  operation: OcppOperationName;
  params: Record<string, unknown>;
  dryRun?: boolean;
}): Promise<OperationResult> {
  const startedAt = new Date();
  const res = await fetch("/api/charger/operation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chargeBoxId: args.chargeBoxId,
      operation: args.operation,
      params: args.params,
      dryRun: args.dryRun ?? false,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error ?? `Operation failed (HTTP ${res.status})`);
  }
  return {
    operationLogId: json.operationLogId,
    taskId: json.taskId ?? null,
    status: json.status ?? "submitted",
    startedAt,
    completedAt: args.dryRun || TERMINAL_STATUSES.has(json.status)
      ? new Date()
      : null,
    error: null,
    pollAttempts: 0,
    result: null,
    operation: args.operation,
  };
}

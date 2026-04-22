/**
 * RemoteStopDialog — ends an active transaction.
 *
 * Pre-fills `transactionId` from the `activeSessions` prop. When multiple
 * active sessions exist (rare — usually 0 or 1), the first is used; the
 * operator can override via the numeric input. The `connectorId` field is
 * not part of RemoteStopTransaction's schema (see `types.ts`).
 */

import { useEffect, useState } from "preact/hooks";
import { toast } from "sonner";
import { Square } from "lucide-preact";
import { ActionDialog } from "./ActionDialog.tsx";
import { type PerDialogProps, submitOperation } from "./types.ts";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";

export default function RemoteStopDialog(props: PerDialogProps) {
  const { chargeBoxId, prefill, activeSessions, isOpen, onClose, onResult } =
    props;
  const defaultTx = typeof prefill.transactionId === "number"
    ? prefill.transactionId
    : activeSessions[0]?.transactionId ?? null;
  const [transactionId, setTransactionId] = useState<string>(
    defaultTx !== null ? String(defaultTx) : "",
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && !transactionId && activeSessions[0]) {
      setTransactionId(String(activeSessions[0].transactionId));
    }
  }, [isOpen]);

  const txIdNum = Number(transactionId);
  const session = activeSessions.find((s) => s.transactionId === txIdNum);
  const recentWarning = (() => {
    if (!session) return null;
    const ageMs = Date.now() - new Date(session.startTimestampIso).getTime();
    if (ageMs < 60_000) {
      return `Transaction #${txIdNum} started ${
        Math.round(ageMs / 1000)
      }s ago — are you sure?`;
    }
    return null;
  })();

  const handleConfirm = async () => {
    if (!Number.isFinite(txIdNum)) {
      setError("Enter a valid transaction ID.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await submitOperation({
        chargeBoxId,
        operation: "RemoteStopTransaction",
        params: { transactionId: txIdNum },
      });
      toast.success("RemoteStop submitted");
      onResult(result);
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error(`RemoteStop failed: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ActionDialog
      icon={Square}
      title="Stop transaction"
      description="Send a RemoteStopTransaction for the live transaction ID."
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={handleConfirm}
      isLoading={submitting}
      errorText={error}
      confirmLabel="Stop transaction"
      confirmVariant="destructive"
      confirmDisabled={!Number.isFinite(txIdNum)}
    >
      <div class="flex flex-col gap-1">
        <Label class="text-xs" for="stop-tx">Transaction ID</Label>
        <Input
          id="stop-tx"
          type="number"
          min={1}
          value={transactionId}
          onInput={(e) =>
            setTransactionId((e.currentTarget as HTMLInputElement).value)}
        />
      </div>
      {recentWarning && (
        <div
          role="alert"
          class="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300"
        >
          {recentWarning}
        </div>
      )}
    </ActionDialog>
  );
}

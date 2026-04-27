/**
 * UnlockConnectorDialog — physically releases the cable.
 *
 * `connectorId` is hidden; injected as 1 (UnlockConnector's Zod schema
 * requires min=1, and our deployment is single-connector).
 */

import { useState } from "preact/hooks";
import { toast } from "sonner";
import { Lock } from "lucide-preact";
import { ActionDialog } from "./ActionDialog.tsx";
import {
  CONNECTOR_INJECTION,
  type PerDialogProps,
  submitOperation,
} from "./types.ts";

export default function UnlockConnectorDialog(props: PerDialogProps) {
  const { chargeBoxId, friendlyName, isOpen, onClose, onResult } = props;
  const displayName = friendlyName?.trim() || chargeBoxId;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const result = await submitOperation({
        chargeBoxId,
        operation: "UnlockConnector",
        params: { connectorId: CONNECTOR_INJECTION.UnlockConnector },
      });
      toast.success("UnlockConnector submitted");
      onResult(result);
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error(`UnlockConnector failed: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ActionDialog
      icon={Lock}
      title="Unlock connector"
      description="Physically releases the cable. Use when a customer can't detach after a completed session."
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={handleConfirm}
      isLoading={submitting}
      errorText={error}
      confirmLabel="Unlock connector"
      confirmVariant="destructive"
    >
      <p class="text-xs text-muted-foreground">
        This will unlock connector 1 on{" "}
        <span class={friendlyName ? "font-medium" : "font-mono"}>
          {displayName}
        </span>.
      </p>
    </ActionDialog>
  );
}

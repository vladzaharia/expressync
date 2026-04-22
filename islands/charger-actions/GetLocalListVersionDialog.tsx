/**
 * GetLocalListVersionDialog — returns the charger's cached local authorization
 * list version. No params besides `chargeBoxId`. No `connectorId` field.
 */

import { useState } from "preact/hooks";
import { toast } from "sonner";
import { Hash } from "lucide-preact";
import { ActionDialog } from "./ActionDialog.tsx";
import { type PerDialogProps, submitOperation } from "./types.ts";

export default function GetLocalListVersionDialog(props: PerDialogProps) {
  const { chargeBoxId, isOpen, onClose, onResult } = props;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const result = await submitOperation({
        chargeBoxId,
        operation: "GetLocalListVersion",
        params: {},
      });
      toast.success("GetLocalListVersion submitted");
      onResult(result);
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error(`GetLocalListVersion failed: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ActionDialog
      icon={Hash}
      title="Get local list version"
      description="Returns the charger's cached local authorization list version."
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={handleConfirm}
      isLoading={submitting}
      errorText={error}
      confirmLabel="Get version"
    >
      <p class="text-xs text-muted-foreground">
        No parameters required.
      </p>
    </ActionDialog>
  );
}

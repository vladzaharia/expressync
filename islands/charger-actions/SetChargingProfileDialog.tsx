/**
 * SetChargingProfileDialog — applies a stored TxDefault/TxProfile to a
 * connector. `connectorId` is hidden; injected as 1 per our single-
 * connector deployment.
 */

import { useState } from "preact/hooks";
import { toast } from "sonner";
import { Zap } from "lucide-preact";
import { ActionDialog } from "./ActionDialog.tsx";
import {
  CONNECTOR_INJECTION,
  type PerDialogProps,
  submitOperation,
} from "./types.ts";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";

export default function SetChargingProfileDialog(props: PerDialogProps) {
  const { chargeBoxId, prefill, isOpen, onClose, onResult } = props;
  const [profilePk, setProfilePk] = useState<string>(
    typeof prefill.chargingProfilePk === "number"
      ? String(prefill.chargingProfilePk)
      : "",
  );
  const [transactionId, setTransactionId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    const pk = Number(profilePk);
    if (!Number.isFinite(pk) || pk < 1) {
      setError("Enter a valid charging profile PK.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const params: Record<string, unknown> = {
        connectorId: CONNECTOR_INJECTION.SetChargingProfile,
        chargingProfilePk: pk,
      };
      const tx = Number(transactionId);
      if (Number.isFinite(tx) && tx > 0) params.transactionId = tx;
      const result = await submitOperation({
        chargeBoxId,
        operation: "SetChargingProfile",
        params,
      });
      toast.success("SetChargingProfile submitted");
      onResult(result);
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error(`SetChargingProfile failed: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ActionDialog
      icon={Zap}
      title="Set charging profile"
      description="Apply a stored TxDefault/TxProfile to this connector."
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={handleConfirm}
      isLoading={submitting}
      errorText={error}
      confirmLabel="Apply profile"
      confirmVariant="destructive"
    >
      <div class="flex flex-col gap-1">
        <Label class="text-xs" for="scp-pk">Charging profile PK</Label>
        <Input
          id="scp-pk"
          type="number"
          min={1}
          value={profilePk}
          onInput={(e) =>
            setProfilePk((e.currentTarget as HTMLInputElement).value)}
        />
      </div>
      <div class="flex flex-col gap-1">
        <Label class="text-xs" for="scp-tx">Transaction ID (optional)</Label>
        <Input
          id="scp-tx"
          type="number"
          min={1}
          value={transactionId}
          onInput={(e) =>
            setTransactionId((e.currentTarget as HTMLInputElement).value)}
        />
      </div>
    </ActionDialog>
  );
}

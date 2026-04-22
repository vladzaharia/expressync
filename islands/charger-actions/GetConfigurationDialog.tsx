/**
 * GetConfigurationDialog — fetches configuration keys from the charger.
 * No `connectorId` field. Leave keys blank to retrieve everything.
 */

import { useState } from "preact/hooks";
import { toast } from "sonner";
import { FileText } from "lucide-preact";
import { ActionDialog } from "./ActionDialog.tsx";
import { type PerDialogProps, submitOperation } from "./types.ts";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";

export default function GetConfigurationDialog(props: PerDialogProps) {
  const { chargeBoxId, isOpen, onClose, onResult } = props;
  const [keys, setKeys] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const params: Record<string, unknown> = {};
      if (keys.trim()) params.commaSeparatedCustomConfKeys = keys.trim();
      const result = await submitOperation({
        chargeBoxId,
        operation: "GetConfiguration",
        params,
      });
      toast.success("GetConfiguration submitted");
      onResult(result);
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error(`GetConfiguration failed: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ActionDialog
      icon={FileText}
      title="Get configuration"
      description="Fetch configuration keys from the charger. Leave blank to retrieve everything."
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={handleConfirm}
      isLoading={submitting}
      errorText={error}
      confirmLabel="Get configuration"
    >
      <div class="flex flex-col gap-1">
        <Label class="text-xs" for="gc-keys">
          Custom keys (comma-separated)
        </Label>
        <Input
          id="gc-keys"
          value={keys}
          onInput={(e) => setKeys((e.currentTarget as HTMLInputElement).value)}
          placeholder="HeartbeatInterval, MeterValueSampleInterval"
        />
      </div>
    </ActionDialog>
  );
}

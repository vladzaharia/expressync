/**
 * TriggerMessageDialog — asks the charger to send one OCPP message now.
 * Default selection = StatusNotification (most common). `connectorId` is
 * hidden; injected as 1 per the single-connector convention.
 */

import { useState } from "preact/hooks";
import { toast } from "sonner";
import { BellRing } from "lucide-preact";
import { ActionDialog } from "./ActionDialog.tsx";
import {
  CONNECTOR_INJECTION,
  type PerDialogProps,
  submitOperation,
} from "./types.ts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { Label } from "@/components/ui/label.tsx";

const OPTIONS = [
  "StatusNotification",
  "Heartbeat",
  "MeterValues",
  "BootNotification",
  "DiagnosticsStatusNotification",
  "FirmwareStatusNotification",
] as const;

export default function TriggerMessageDialog(props: PerDialogProps) {
  const { chargeBoxId, isOpen, onClose, onResult } = props;
  const [trigger, setTrigger] = useState<string>("StatusNotification");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const result = await submitOperation({
        chargeBoxId,
        operation: "TriggerMessage",
        params: {
          triggerMessage: trigger,
          connectorId: CONNECTOR_INJECTION.TriggerMessage,
        },
      });
      toast.success("TriggerMessage submitted");
      onResult(result);
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error(`TriggerMessage failed: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ActionDialog
      icon={BellRing}
      title="Trigger message"
      description="Ask the charger to send one OCPP message now (useful for forcing a status refresh)."
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={handleConfirm}
      isLoading={submitting}
      errorText={error}
      confirmLabel="Trigger"
    >
      <div class="flex flex-col gap-1">
        <Label class="text-xs" for="tm-message">Message</Label>
        <Select value={trigger} onValueChange={setTrigger}>
          <SelectTrigger id="tm-message">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OPTIONS.map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </ActionDialog>
  );
}

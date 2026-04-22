/**
 * GetCompositeScheduleDialog — retrieves the active charging schedule.
 * `connectorId` is hidden; injected as 1.
 */

import { useState } from "preact/hooks";
import { toast } from "sonner";
import { ListOrdered } from "lucide-preact";
import { ActionDialog } from "./ActionDialog.tsx";
import {
  CONNECTOR_INJECTION,
  type PerDialogProps,
  submitOperation,
} from "./types.ts";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";

export default function GetCompositeScheduleDialog(props: PerDialogProps) {
  const { chargeBoxId, isOpen, onClose, onResult } = props;
  const [duration, setDuration] = useState<string>("3600");
  const [rateUnit, setRateUnit] = useState<string>("A");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    const d = Number(duration);
    if (!Number.isFinite(d) || d < 1) {
      setError("Enter a duration in seconds (≥ 1).");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await submitOperation({
        chargeBoxId,
        operation: "GetCompositeSchedule",
        params: {
          connectorId: CONNECTOR_INJECTION.GetCompositeSchedule,
          durationInSeconds: d,
          chargingRateUnit: rateUnit,
        },
      });
      toast.success("GetCompositeSchedule submitted");
      onResult(result);
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error(`GetCompositeSchedule failed: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ActionDialog
      icon={ListOrdered}
      title="Get composite schedule"
      description="Retrieve the currently active charging schedule for this charger."
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={handleConfirm}
      isLoading={submitting}
      errorText={error}
      confirmLabel="Get schedule"
    >
      <div class="flex flex-col gap-1">
        <Label class="text-xs" for="gcs-duration">Duration (seconds)</Label>
        <Input
          id="gcs-duration"
          type="number"
          min={1}
          value={duration}
          onInput={(e) =>
            setDuration((e.currentTarget as HTMLInputElement).value)}
        />
      </div>
      <div class="flex flex-col gap-1">
        <Label class="text-xs" for="gcs-unit">Rate unit</Label>
        <Select value={rateUnit} onValueChange={setRateUnit}>
          <SelectTrigger id="gcs-unit">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="A">Amps (A)</SelectItem>
            <SelectItem value="W">Watts (W)</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </ActionDialog>
  );
}

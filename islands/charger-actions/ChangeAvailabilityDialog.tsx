/**
 * ChangeAvailabilityDialog — toggles charger (whole) Operative/Inoperative.
 * `connectorId` is hidden; injected as 0 (whole charger). Choosing
 * `Inoperative` flips the confirm button to destructive and surfaces a
 * warning banner.
 */

import { useState } from "preact/hooks";
import { toast } from "sonner";
import { Ban } from "lucide-preact";
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

export default function ChangeAvailabilityDialog(props: PerDialogProps) {
  const { chargeBoxId, isOpen, onClose, onResult } = props;
  const [availType, setAvailType] = useState<"Operative" | "Inoperative">(
    "Operative",
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDestructive = availType === "Inoperative";

  const handleConfirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const result = await submitOperation({
        chargeBoxId,
        operation: "ChangeAvailability",
        params: {
          availType,
          connectorId: CONNECTOR_INJECTION.ChangeAvailability,
        },
      });
      toast.success("ChangeAvailability submitted");
      onResult(result);
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error(`ChangeAvailability failed: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ActionDialog
      icon={Ban}
      title="Change availability"
      description="Put the charge point Operative or Inoperative (applies to the whole charger)."
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={handleConfirm}
      isLoading={submitting}
      errorText={error}
      confirmLabel="Apply availability"
      confirmVariant={isDestructive ? "destructive" : "default"}
    >
      <div class="flex flex-col gap-1">
        <Label class="text-xs" for="avail-type">Availability</Label>
        <Select
          value={availType}
          onValueChange={(v: string) =>
            setAvailType(v as "Operative" | "Inoperative")}
        >
          <SelectTrigger id="avail-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Operative">Operative</SelectItem>
            <SelectItem value="Inoperative">Inoperative</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {isDestructive && (
        <div
          role="alert"
          class="rounded-md border border-rose-500/40 bg-rose-500/10 p-2 text-xs text-rose-700 dark:text-rose-300"
        >
          This will take the charger out of service. Existing sessions keep
          running until they end; no new sessions will start.
        </div>
      )}
    </ActionDialog>
  );
}

/**
 * CancelReservationDialog — cancels an existing reservation by ID.
 * No `connectorId` field (not part of CancelReservation's schema).
 */

import { useState } from "preact/hooks";
import { toast } from "sonner";
import { TimerOff } from "lucide-preact";
import { ActionDialog } from "./ActionDialog.tsx";
import { type PerDialogProps, submitOperation } from "./types.ts";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";

export default function CancelReservationDialog(props: PerDialogProps) {
  const { chargeBoxId, prefill, isOpen, onClose, onResult } = props;
  const [reservationId, setReservationId] = useState<string>(
    typeof prefill.reservationId === "number"
      ? String(prefill.reservationId)
      : "",
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    const n = Number(reservationId);
    if (!Number.isFinite(n) || n < 0) {
      setError("Enter a valid reservation ID.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await submitOperation({
        chargeBoxId,
        operation: "CancelReservation",
        params: { reservationId: n },
      });
      toast.success("CancelReservation submitted");
      onResult(result);
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error(`CancelReservation failed: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ActionDialog
      icon={TimerOff}
      title="Cancel reservation"
      description="Cancels an existing reservation by its ID."
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={handleConfirm}
      isLoading={submitting}
      errorText={error}
      confirmLabel="Cancel reservation"
    >
      <div class="flex flex-col gap-1">
        <Label class="text-xs" for="cr-id">Reservation ID</Label>
        <Input
          id="cr-id"
          type="number"
          min={0}
          value={reservationId}
          onInput={(e) =>
            setReservationId((e.currentTarget as HTMLInputElement).value)}
        />
      </div>
    </ActionDialog>
  );
}

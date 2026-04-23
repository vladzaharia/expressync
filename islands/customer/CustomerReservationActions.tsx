/**
 * CustomerReservationActions — read + cancel button for the customer
 * reservation detail page.
 *
 * Polaris Track G3 — slimmed-down counterpart to the admin
 * `ReservationDetail` island. Customers can only cancel their own
 * reservations (DELETE /api/customer/reservations/[id]); rescheduling is
 * intentionally out of scope for the MVP customer surface.
 *
 * Cancel uses the canonical `ConfirmDialog` destructive variant so the
 * safe option (Cancel) keeps focus on dialog open. Successful cancel
 * triggers a full reload so the page picks up the new status from the
 * loader.
 */

import { useState } from "preact/hooks";
import { toast } from "sonner";
import { XCircle } from "lucide-preact";
import { Button } from "@/components/ui/button.tsx";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog.tsx";
import type { ReservationStatus } from "@/src/db/schema.ts";

interface Props {
  reservationId: number;
  status: ReservationStatus;
}

const TERMINAL: ReservationStatus[] = [
  "cancelled",
  "completed",
  "orphaned",
];

export default function CustomerReservationActions(
  { reservationId, status }: Props,
) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (TERMINAL.includes(status)) return null;

  const doCancel = async () => {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/customer/reservations/${reservationId}`,
        { method: "DELETE" },
      );
      if (res.ok) {
        toast.success("Reservation cancelled");
        globalThis.location.reload();
        return;
      }
      const body = await res.json().catch(() => ({})) as { error?: string };
      toast.error(body.error ?? `Failed to cancel (${res.status})`);
    } catch {
      toast.error("Failed to cancel reservation");
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        class="border-rose-500/40 text-rose-700 hover:bg-rose-500/10 dark:text-rose-400"
      >
        <XCircle class="size-4" aria-hidden="true" />
        Cancel
      </Button>

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Cancel this reservation?"
        description="The booking window is released immediately. This cannot be undone."
        variant="destructive"
        confirmLabel="Cancel reservation"
        cancelLabel="Keep"
        onConfirm={doCancel}
        isLoading={busy}
        confirmDisabled={busy}
      />
    </>
  );
}

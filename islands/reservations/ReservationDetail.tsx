/**
 * ReservationDetail — detail-page interactive surface.
 *
 * Provides Reschedule + Cancel. Layout + header live in the server-rendered
 * page; this island renders only the action buttons and the confirm dialog.
 *
 * Cancel dialog initial focus is the SAFE option ("Keep"); destructive
 * button labeled "Cancel Reservation" to avoid the ambiguous "Confirm".
 */

import { useEffect, useRef, useState } from "preact/hooks";
import { toast } from "sonner";
import { CalendarClock, Loader2, XCircle } from "lucide-preact";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { ConflictWarning } from "@/components/reservations/ConflictWarning.tsx";
import {
  DateTimeRangePicker,
  type PickerConflict,
} from "@/components/reservations/DateTimeRangePicker.tsx";
import type { ReservationStatus } from "@/src/db/schema.ts";

interface Props {
  reservationId: number;
  status: ReservationStatus;
  startAtIso: string;
  endAtIso: string;
  tz?: string | null;
}

interface Conflict {
  id: number;
  startAtIso: string;
  endAtIso: string;
  status: ReservationStatus;
  steveOcppIdTag: string;
}

export default function ReservationDetail(
  { reservationId, status, startAtIso, endAtIso, tz }: Props,
) {
  const [cancelOpen, setCancelOpen] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [rescheduleBusy, setRescheduleBusy] = useState(false);

  const [newStartDate, setNewStartDate] = useState<Date>(
    () => new Date(startAtIso),
  );
  const [newEndDate, setNewEndDate] = useState<Date>(() => new Date(endAtIso));
  const [conflicts, setConflicts] = useState<Conflict[]>([]);

  const keepButtonRef = useRef<HTMLButtonElement>(null);

  // Focus the safe option when the cancel dialog opens.
  useEffect(() => {
    if (!cancelOpen) return;
    const t = setTimeout(() => keepButtonRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [cancelOpen]);

  const terminal = status === "cancelled" || status === "completed" ||
    status === "orphaned";

  const doCancel = async () => {
    setCancelBusy(true);
    try {
      const res = await fetch(`/api/reservations/${reservationId}`, {
        method: "DELETE",
      });
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
      setCancelBusy(false);
      setCancelOpen(false);
    }
  };

  const doReschedule = async () => {
    const start = newStartDate;
    const end = newEndDate;
    if (
      Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) ||
      end.getTime() <= start.getTime()
    ) {
      toast.error("Invalid time window");
      return;
    }
    setRescheduleBusy(true);
    try {
      const res = await fetch(`/api/reservations/${reservationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startAtIso: start.toISOString(),
          endAtIso: end.toISOString(),
        }),
      });
      if (res.ok) {
        toast.success("Reservation updated");
        globalThis.location.reload();
        return;
      }
      if (res.status === 409) {
        const body = await res.json() as { conflicts?: Conflict[] };
        setConflicts(body.conflicts ?? []);
        toast.error("Time window conflicts with existing reservation(s)");
        return;
      }
      const body = await res.json().catch(() => ({})) as { error?: string };
      toast.error(body.error ?? `Failed to update (${res.status})`);
    } catch {
      toast.error("Failed to update reservation");
    } finally {
      setRescheduleBusy(false);
    }
  };

  return (
    <div class="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        disabled={terminal}
        onClick={() => setRescheduleOpen(true)}
      >
        <CalendarClock class="mr-2 size-4" /> Reschedule
      </Button>
      <Button
        variant="outline"
        disabled={terminal}
        onClick={() => setCancelOpen(true)}
        class="border-rose-500/40 text-rose-700 hover:bg-rose-500/10 dark:text-rose-400"
      >
        <XCircle class="mr-2 size-4" /> Cancel
      </Button>

      {/* Cancel dialog */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent onClose={() => setCancelOpen(false)}>
          <DialogHeader>
            <DialogTitle>Cancel this reservation?</DialogTitle>
            <DialogDescription>
              The booking window is released immediately. You can keep it if you
              want to come back to this.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              ref={keepButtonRef as unknown as preact.RefObject<
                HTMLButtonElement
              >}
              onClick={() => setCancelOpen(false)}
              disabled={cancelBusy}
            >
              Keep
            </Button>
            <Button
              variant="outline"
              onClick={doCancel}
              disabled={cancelBusy}
              class="border-rose-500/40 text-rose-700 hover:bg-rose-500/10 dark:text-rose-400"
            >
              {cancelBusy
                ? (
                  <>
                    <Loader2 class="mr-2 size-4 animate-spin" /> Cancelling…
                  </>
                )
                : "Cancel Reservation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reschedule dialog */}
      <Dialog open={rescheduleOpen} onOpenChange={setRescheduleOpen}>
        <DialogContent onClose={() => setRescheduleOpen(false)}>
          <DialogHeader>
            <DialogTitle>Reschedule reservation</DialogTitle>
            <DialogDescription>
              Pick a new start time and duration. Conflicts will be shown
              inline.
            </DialogDescription>
          </DialogHeader>
          <div class="flex flex-col gap-3">
            <DateTimeRangePicker
              value={{ startAt: newStartDate, endAt: newEndDate }}
              onChange={(next) => {
                setNewStartDate(next.startAt);
                setNewEndDate(next.endAt);
                setConflicts([]);
              }}
              tz={tz ?? undefined}
              minuteStep={15}
              conflicts={conflicts satisfies PickerConflict[]}
              variant="compact"
              idPrefix="reschedule"
            />
            <ConflictWarning
              conflicts={conflicts}
              tz={tz ?? undefined}
              onPickSuggestion={(iso) => {
                const d = new Date(iso);
                const durMs = newEndDate.getTime() - newStartDate.getTime();
                setNewStartDate(d);
                setNewEndDate(new Date(d.getTime() + durMs));
                setConflicts([]);
              }}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRescheduleOpen(false)}
              disabled={rescheduleBusy}
            >
              Cancel
            </Button>
            <Button onClick={doReschedule} disabled={rescheduleBusy}>
              {rescheduleBusy
                ? (
                  <>
                    <Loader2 class="mr-2 size-4 animate-spin" /> Saving…
                  </>
                )
                : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

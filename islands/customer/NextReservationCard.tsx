/**
 * NextReservationCard — compact view of the user's next upcoming
 * reservation. Renders the date, a relative countdown (recomputed every
 * 60s), the friendly charger name + connector chip, status badge, and
 * Edit / Cancel actions.
 *
 * Cancel opens a destructive ConfirmDialog and DELETEs the reservation
 * via `/api/reservations/[id]`. On success we hide the card optimistically
 * — the dashboard's next loader call will return null for `nextReservation`
 * and the section will collapse.
 */

import { useEffect, useState } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { CalendarClock, Edit, Plug, Trash2, Zap } from "lucide-preact";
import { Button } from "@/components/ui/button.tsx";
import ConfirmDialog from "@/components/shared/ConfirmDialog.tsx";
import { ReservationStatusBadge } from "@/components/shared/ReservationStatusBadge.tsx";
import { toast } from "sonner";

interface Reservation {
  id: number;
  chargeBoxId: string;
  /** Operator-set friendly name (mirrored from StEvE description). */
  friendlyName?: string | null;
  connectorId: number | null;
  connectorType?: string | null;
  startAtIso: string;
  endAtIso: string;
  status: string;
  displayName?: string | null;
}

interface Props {
  reservation: Reservation;
}

function formatRelativeFuture(target: Date, now: Date): string {
  let diff = Math.round((target.getTime() - now.getTime()) / 1000);
  const past = diff < 0;
  diff = Math.abs(diff);
  const minutes = Math.round(diff / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days >= 1) {
    return past ? `${days}d ago` : `in ${days}d ${hours % 24}h`;
  }
  if (hours >= 1) {
    return past
      ? `${hours}h ${minutes % 60}m ago`
      : `in ${hours}h ${minutes % 60}m`;
  }
  if (minutes >= 1) return past ? `${minutes}m ago` : `in ${minutes}m`;
  return past ? "just now" : "starting now";
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: "short",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function NextReservationCard({ reservation }: Props) {
  const now = useSignal<number>(Date.now());
  const [hidden, setHidden] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    const id = setInterval(() => {
      now.value = Date.now();
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  if (hidden) return null;

  const start = new Date(reservation.startAtIso);
  const countdown = formatRelativeFuture(start, new Date(now.value));

  const handleCancel = async () => {
    setCancelling(true);
    try {
      const res = await fetch(`/api/reservations/${reservation.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "Failed to cancel reservation");
      }
      toast.success("Reservation cancelled");
      setHidden(true);
      setConfirmOpen(false);
    } catch (err) {
      const msg = err instanceof Error
        ? err.message
        : "Failed to cancel reservation";
      toast.error(msg);
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div data-tour="reserve" class="flex flex-col gap-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="flex items-center gap-2 text-sm font-semibold">
            <CalendarClock
              class="size-4 text-indigo-500"
              aria-hidden="true"
            />
            {formatDate(reservation.startAtIso)}
          </div>
          <p class="mt-0.5 text-xs text-muted-foreground tabular-nums">
            {countdown}
          </p>
        </div>
        <ReservationStatusBadge
          status={reservation.status as never}
        />
      </div>

      <div class="flex flex-wrap items-center gap-2 text-sm">
        {(() => {
          const friendly = reservation.friendlyName?.trim() ?? "";
          const useFriendly = friendly.length > 0 &&
            friendly !== reservation.chargeBoxId;
          return (
            <span class="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-0.5 text-xs">
              <Zap class="size-3.5 text-orange-500" aria-hidden="true" />
              {useFriendly
                ? (
                  <>
                    <span class="font-medium">{friendly}</span>
                    <span class="font-mono text-[10px] text-muted-foreground">
                      {reservation.chargeBoxId}
                    </span>
                  </>
                )
                : <span class="font-mono">{reservation.chargeBoxId}</span>}
            </span>
          );
        })()}
        {reservation.connectorId != null && (
          <span class="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-0.5 text-xs">
            <Plug class="size-3.5 text-cyan-500" aria-hidden="true" />
            Connector {reservation.connectorId}
            {reservation.connectorType && (
              <span class="text-muted-foreground">
                · {reservation.connectorType}
              </span>
            )}
          </span>
        )}
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <Button
          asChild
          size="mobile"
          variant="outline"
          class="flex-1 sm:flex-initial"
        >
          <a
            href={`/reservations/${reservation.id}`}
            aria-label="Edit reservation"
          >
            <Edit class="size-4" />
            <span>Edit</span>
          </a>
        </Button>
        <Button
          type="button"
          size="mobile"
          variant="outline"
          onClick={() => setConfirmOpen(true)}
          aria-label="Cancel reservation"
          class="flex-1 sm:flex-initial border-destructive/40 text-destructive hover:bg-destructive/10"
        >
          <Trash2 class="size-4" />
          <span>Cancel</span>
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Cancel reservation?"
        description={
          <span>
            You're about to cancel your reservation for{" "}
            <span class="font-medium">
              {reservation.friendlyName?.trim() || reservation.chargeBoxId}
            </span>{" "}
            on{" "}
            <span class="font-medium">
              {formatDate(reservation.startAtIso)}
            </span>. This cannot be undone.
          </span>
        }
        variant="destructive"
        confirmLabel="Cancel reservation"
        cancelLabel="Keep reservation"
        icon={<Trash2 class="size-5 text-destructive" />}
        onConfirm={handleCancel}
        isLoading={cancelling}
      />
    </div>
  );
}

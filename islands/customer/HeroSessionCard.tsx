/**
 * HeroSessionCard — the customer dashboard "you are charging right now"
 * card. Wraps the existing Wave C2 `LiveSessionCard` (admin/customer
 * shared) and adds:
 *   • a tag chip ("Card: Vlad's keyfob") so the customer knows which card
 *     authenticated this session
 *   • a full-width destructive Stop button (mobile-sized)
 *   • a `ConfirmDialog` that shows current kWh + cost; on confirm it POSTs
 *     to `/api/customer/session-stop` and shows a 5-second undo toast.
 *
 * Live data flows through the inner `LiveSessionCard`'s SSE subscription.
 * The Stop side-effect is owned by THIS island so the toast lifecycle is
 * scoped to the card the user actually pressed.
 */

import { useState } from "preact/hooks";
import { CreditCard, StopCircle } from "lucide-preact";
import { Button } from "@/components/ui/button.tsx";
import ConfirmDialog from "@/components/shared/ConfirmDialog.tsx";
import LiveSessionCard from "@/islands/charging-sessions/LiveSessionCard.tsx";
import { toast } from "sonner";

interface HeroSession {
  steveTransactionId: number;
  chargeBoxId: string | null;
  /** Operator-set friendly name (mirrored from StEvE description). */
  friendlyName?: string | null;
  connectorId?: number | null;
  connectorType?: string | null;
  /** Initial energy in kWh — refreshed live by LiveSessionCard's SSE. */
  initialKwh: number;
  /** ISO timestamp the session started. */
  startedAt: string | null;
  /** Tag display name ("Vlad's keyfob"). */
  tagDisplayName: string | null;
  /** Estimated cost in user currency. */
  estimatedCost?: number;
  currencySymbol?: string;
  /**
   * Per-kWh tariff resolved from the customer's active Lago plan. When
   * present, the live card renders a running cost tile that updates as
   * kWh climbs. Omit for flat-rate / membership plans where running cost
   * is not meaningful.
   */
  tariffPerKwh?: number;
  /** Vehicle efficiency override (mi/kWh); defaults to 4. */
  milesPerKwh?: number;
  distanceUnit?: "imperial" | "metric";
  /** Authoritative billed kWh from the Lago billing pipeline. */
  billedKwh?: number;
  /** Authoritative billed cost in cents from the Lago billing pipeline. */
  billedCostCents?: number;
  /** Customer wallet balance in cents (renders an extra tile). */
  walletBalanceCents?: number;
  /** Wallet auto-top-up threshold in cents. */
  walletThresholdCents?: number;
}

interface Props {
  session: HeroSession;
}

export default function HeroSessionCard({ session }: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [stopping, setStopping] = useState(false);

  const handleStop = async () => {
    setStopping(true);
    try {
      const res = await fetch("/api/customer/session-stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactionId: session.steveTransactionId,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "Failed to stop session");
      }
      // Removed the misleading "Undo for 5s" affordance: the resume path
      // is owned by the scan-start flow and the toast cannot truly undo
      // the OCPP RemoteStop. A simple confirmation toast keeps the UX
      // honest.
      toast.success("Stopping…", {
        description: "We've asked the charger to stop charging.",
        duration: 4000,
      });
      setConfirmOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to stop";
      toast.error(msg);
    } finally {
      setStopping(false);
    }
  };

  return (
    <div data-tour="hero" class="space-y-3">
      <LiveSessionCard
        steveTransactionId={session.steveTransactionId}
        chargeBoxId={session.chargeBoxId}
        friendlyName={session.friendlyName}
        connectorId={session.connectorId ?? null}
        initialKwh={session.initialKwh}
        startedAt={session.startedAt}
        tariffPerKwh={session.tariffPerKwh}
        currencySymbol={session.currencySymbol}
        milesPerKwh={session.milesPerKwh}
        distanceUnit={session.distanceUnit}
        billedKwh={session.billedKwh}
        billedCostCents={session.billedCostCents}
        walletBalanceCents={session.walletBalanceCents}
        walletThresholdCents={session.walletThresholdCents}
      />

      {/* Tag chip + Stop CTA */}
      <div class="flex flex-wrap items-center gap-3">
        {session.tagDisplayName && (
          <span class="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-xs">
            <CreditCard class="size-3.5 text-cyan-500" aria-hidden="true" />
            <span class="text-muted-foreground">Card:</span>
            <span class="font-medium">{session.tagDisplayName}</span>
          </span>
        )}
        <Button
          type="button"
          variant="destructive"
          size="mobile"
          onClick={() => setConfirmOpen(true)}
          aria-label="Stop charging"
          class="ml-auto w-full sm:w-auto"
        >
          <StopCircle class="size-4" />
          <span>Stop charging</span>
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Stop charging?"
        description={
          <span>
            You're about to stop charging on{" "}
            <span class="font-medium">
              {session.friendlyName?.trim() || session.chargeBoxId ||
                "the charger"}
            </span>. Current usage:{" "}
            <span class="font-semibold tabular-nums">
              {session.initialKwh.toFixed(2)} kWh
            </span>
            {session.estimatedCost !== undefined
              ? (
                <>
                  {" "}({session.currencySymbol ?? "€"}
                  {session.estimatedCost.toFixed(2)})
                </>
              )
              : null}.
          </span>
        }
        variant="destructive"
        confirmLabel="Stop charging"
        icon={<StopCircle class="size-5 text-destructive" />}
        onConfirm={handleStop}
        isLoading={stopping}
      />
    </div>
  );
}

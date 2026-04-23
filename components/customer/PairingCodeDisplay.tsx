/**
 * Polaris Track E — large monospace pairing-code display.
 *
 * Used inside the customer scan-to-login modal once `/api/auth/scan-pair`
 * returns the pairing code. The code itself is purely informational for
 * the user (it lets them confirm the same code is shown on the device they
 * tap), and the BorderBeam glow communicates "live, listening for a tap".
 *
 * Layout: centered, padded, big tracking-widest text. Countdown text below
 * uses `aria-live=polite` so screen readers announce the deadline as it
 * approaches without spamming the user every second.
 */

import { BorderBeam } from "@/components/magicui/border-beam.tsx";
import { cn } from "@/src/lib/utils/cn.ts";

interface PairingCodeDisplayProps {
  pairingCode: string;
  /** Seconds remaining until the pairing expires. Drives the countdown copy. */
  secondsRemaining: number;
  /** Optional friendly name of the bound charger ("Garage", "EVSE-1", etc.). */
  chargerName?: string | null;
  /** Hide the BorderBeam glow (e.g. when `prefers-reduced-motion` is set). */
  noBeam?: boolean;
  className?: string;
}

export function PairingCodeDisplay({
  pairingCode,
  secondsRemaining,
  chargerName,
  noBeam,
  className,
}: PairingCodeDisplayProps) {
  return (
    <div
      class={cn(
        "relative rounded-xl border border-border bg-card/60 px-6 py-8 text-center shadow-sm",
        className,
      )}
    >
      {chargerName
        ? (
          <p class="text-xs uppercase tracking-wider text-muted-foreground mb-2">
            Tap your card on{" "}
            <span class="font-medium text-foreground">{chargerName}</span>
          </p>
        )
        : null}
      <p
        class="text-4xl font-mono font-bold tracking-widest break-all text-foreground"
        aria-label={`Pairing code ${pairingCode.split("").join(" ")}`}
      >
        {pairingCode}
      </p>
      <p
        class="text-xs text-muted-foreground mt-3"
        aria-live="polite"
        aria-atomic="true"
      >
        Pairing expires in{" "}
        <span class="font-medium text-foreground">
          {Math.max(0, secondsRemaining)}s
        </span>
      </p>
      {!noBeam
        ? (
          <BorderBeam
            size={120}
            duration={6}
            colorFrom="var(--glow-cyan, #22d3ee)"
            colorTo="var(--glow-green, #84cc16)"
            className="rounded-xl"
          />
        )
        : null}
    </div>
  );
}

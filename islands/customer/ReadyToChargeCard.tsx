/**
 * ReadyToChargeCard — idle-state hero shown when the user has no active
 * session.
 *
 * Highlights:
 *   • Cyan BorderBeam (slow, calm — vs. green for active charging)
 *   • Hero copy "Ready when you are."
 *   • Two CTAs: "Scan to start" (deep-links to /login/scan since
 *     StartChargingSheet lives in Track G2 and isn't built yet) and
 *     "Pick charger" (links to /chargers — Track G2 will swap this for
 *     the bottom-sheet once it exists).
 *   • Subscribes to `charger.state` SSE events to refresh the
 *     "🟢 N chargers available" pill.
 *   • Mini "Last session" row at the bottom linking to the most recent
 *     session detail.
 */

import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { ArrowRight, Search, Zap } from "lucide-preact";
import { Button } from "@/components/ui/button.tsx";
import { BorderBeam } from "@/components/magicui/border-beam.tsx";
import { borderBeamColors } from "@/src/lib/colors.ts";
import { subscribeSse } from "@/islands/shared/SseProvider.tsx";
import { formatRelative } from "@/islands/shared/charger-visuals.ts";
import { cn } from "@/src/lib/utils/cn.ts";

interface LastSessionSummary {
  id: number;
  steveTransactionId: number;
  syncedAt: string | null;
  kwhDelta: number;
  costString?: string | null;
}

interface Props {
  initialAvailableChargers?: number;
  totalChargers?: number;
  lastSession?: LastSessionSummary | null;
}

interface ChargerStatePayload {
  chargeBoxId: string;
  status?: string;
}

export default function ReadyToChargeCard(
  {
    initialAvailableChargers = 0,
    totalChargers = 0,
    lastSession = null,
  }: Props,
) {
  const available = useSignal<number>(initialAvailableChargers);

  // Lightweight SSE → bump the available counter when chargers come/go.
  // We don't track per-charger ids here (that's Track L's job); the dashboard
  // pill is just a directional hint.
  useEffect(() => {
    const unsub = subscribeSse("charger.state", (raw) => {
      const p = raw as ChargerStatePayload;
      if (!p.status) return;
      const becameAvailable = p.status === "Available";
      const wasUnavailable = p.status === "Charging" ||
        p.status === "Faulted" ||
        p.status === "Offline" || p.status === "Unavailable";
      if (becameAvailable) {
        available.value = Math.min(
          available.value + 1,
          totalChargers || available.value + 1,
        );
      } else if (wasUnavailable) {
        available.value = Math.max(0, available.value - 1);
      }
    });
    return unsub;
  }, []);

  return (
    <div
      class="relative overflow-hidden rounded-xl border bg-card"
      data-tour="hero"
    >
      <div class="relative px-6 py-8 text-center">
        <div class="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-cyan-500/15">
          <Zap
            class="size-6 text-cyan-600 dark:text-cyan-400"
            aria-hidden="true"
          />
        </div>
        <h2 class="text-xl font-semibold">Ready when you are</h2>
        <p class="mt-1 text-sm text-muted-foreground">
          Tap your card on a charger or pick one to get going.
        </p>

        {/* Available pill */}
        <div class="mt-4 inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-xs">
          <span
            class={cn(
              "relative flex size-2 shrink-0 rounded-full",
              available.value > 0 ? "bg-emerald-500" : "bg-muted-foreground/40",
            )}
            aria-hidden="true"
          />
          <span class="font-medium">
            {available.value} of {Math.max(totalChargers, available.value)}
          </span>
          <span class="text-muted-foreground">
            charger{available.value === 1 ? "" : "s"} available
          </span>
        </div>

        <div class="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button
            asChild
            size="mobile"
            class="w-full sm:w-auto"
          >
            <a href="/login/scan" aria-label="Scan to start charging">
              <Search class="size-4" />
              <span>Scan to start</span>
            </a>
          </Button>
          <Button
            asChild
            size="mobile"
            variant="outline"
            class="w-full sm:w-auto"
            data-tour="pick-charger"
          >
            {/* Track G2 will swap this for the StartChargingSheet bottom-sheet */}
            <a href="/" aria-label="Pick a charger">
              <span>Pick charger</span>
            </a>
          </Button>
        </div>
      </div>

      {/* Mini "Last session" row */}
      {lastSession && (
        <a
          href={`/sessions/${lastSession.steveTransactionId}`}
          class="flex items-center justify-between gap-3 border-t px-6 py-3 text-xs hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="View your last session"
        >
          <span class="text-muted-foreground">
            Last session:{" "}
            <span class="text-foreground">
              {lastSession.syncedAt
                ? formatRelative(lastSession.syncedAt)
                : "—"}
            </span>
            <span class="mx-1.5 text-muted-foreground">·</span>
            <span class="tabular-nums">
              {lastSession.kwhDelta.toFixed(1)} kWh
            </span>
            {lastSession.costString && (
              <>
                <span class="mx-1.5 text-muted-foreground">·</span>
                <span class="tabular-nums">{lastSession.costString}</span>
              </>
            )}
          </span>
          <span class="inline-flex items-center gap-1 text-cyan-600 dark:text-cyan-400">
            View
            <ArrowRight class="size-3" />
          </span>
        </a>
      )}

      <BorderBeam
        size={180}
        duration={20}
        colorFrom={borderBeamColors.cyan.from}
        colorTo={borderBeamColors.cyan.to}
        className="opacity-70"
      />
    </div>
  );
}

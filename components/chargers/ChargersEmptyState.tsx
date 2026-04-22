/**
 * ChargersEmptyState — illustrated first-run state for `/chargers`.
 *
 * Shown when the `chargers_cache` table is empty. Directs the operator to
 * StEvE's "Add Charge Point" admin page; the charger appears here once StEvE
 * sends its first StatusNotification (the sync worker stamps the cache).
 *
 * Server-rendered.
 */

import { BatteryCharging, ExternalLink } from "lucide-preact";
import { GridPattern } from "@/components/magicui/grid-pattern.tsx";

interface Props {
  steveUrl: string;
}

export function ChargersEmptyState({ steveUrl }: Props) {
  const href = `${steveUrl}/manager/chargepoints/add`;

  return (
    <div class="relative overflow-hidden rounded-xl border bg-card p-12 text-center">
      <GridPattern
        class="absolute inset-0 -z-10 opacity-40 [mask-image:radial-gradient(300px_circle_at_center,white,transparent)] text-orange-500/30"
      />
      <BatteryCharging
        class="mx-auto size-12 text-orange-500"
        aria-hidden="true"
      />
      <p class="mt-4 text-base font-medium">No chargers yet</p>
      <p class="mt-1 text-sm text-muted-foreground">
        Register a charge box in StEvE — it appears here after first
        StatusNotification.
      </p>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        class="mt-6 inline-flex items-center gap-2 rounded-md bg-orange-500 px-4 py-2 text-sm font-medium text-white hover:bg-orange-500/90"
        aria-label="Register charger in StEvE (opens in new tab)"
      >
        <ExternalLink class="size-4" aria-hidden="true" />
        Register charger in StEvE
      </a>
    </div>
  );
}

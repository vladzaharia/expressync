/**
 * ChargersEmptyState — illustrated first-run state for `/chargers`.
 *
 * Thin wrapper over the shared `<EmptyState>`. Shown when the
 * `chargers_cache` table is empty. Directs the operator to StEvE's "Add
 * Charge Point" admin page; the charger appears here once StEvE sends its
 * first StatusNotification (the sync worker stamps the cache).
 */

import { BatteryCharging } from "lucide-preact";
import { EmptyState } from "@/components/shared/EmptyState.tsx";

interface Props {
  steveUrl: string;
}

export function ChargersEmptyState({ steveUrl }: Props) {
  return (
    <EmptyState
      icon={BatteryCharging}
      accent="orange"
      title="No chargers yet"
      description="Register a charge box in StEvE — it appears here after first StatusNotification."
      primaryAction={{
        label: "Register charger in StEvE",
        href: `${steveUrl}/manager/chargepoints/add`,
        external: true,
        ariaLabel: "Register charger in StEvE (opens in new tab)",
      }}
    />
  );
}

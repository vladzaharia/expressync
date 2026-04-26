/**
 * Server-rendered header strip for `/chargers/[chargeBoxId]`.
 *
 * Visual contract: friendlyName (already rendered above via PageCard title) +
 * the mono `chargeBoxId` + a wrapping row of status pills via `StatusPillRow`.
 *
 * Pills shown:
 *   - Registration status (Accepted / Pending / Rejected) — from StEvE
 *   - Derived online/offline (via `lastStatusAt` freshness)
 *   - Aggregate connector roll-up ("1 Available / 1 Charging")
 *   - Stale indicator (dashed) when the cached status is older than the
 *     staleness threshold but the charger hasn't gone fully offline yet
 *
 * Kept as a server component because none of the data is interactive — the
 * live-status refresh button lives inside `ChargerLiveStatusCard` (an island).
 */

import { type Pill, StatusPillRow } from "@/components/tags/StatusPillRow.tsx";
import { formatRelative } from "@/islands/shared/device-visuals.ts";

interface ConnectorSummary {
  uiStatus: string; // we only need the label; already normalized server-side
}

interface Props {
  chargeBoxId: string;
  registrationStatus: "Accepted" | "Pending" | "Rejected" | null;
  uiStatus:
    | "Available"
    | "Charging"
    | "Reserved"
    | "Offline"
    | "Faulted"
    | "Unavailable";
  isStale: boolean;
  isOffline: boolean;
  lastStatusAtIso: string | null;
  connectors: ConnectorSummary[];
}

/**
 * Roll per-connector statuses up into a human-readable summary.
 * "1 Available / 2 Charging" reads cleaner than a raw count table.
 */
function summarizeConnectors(connectors: ConnectorSummary[]): string {
  if (connectors.length === 0) return "No connectors";
  const counts = new Map<string, number>();
  for (const c of connectors) {
    const key = c.uiStatus ?? "Unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([label, n]) => `${n} ${label}`)
    .join(" · ");
}

export function ChargerHeaderStrip({
  chargeBoxId,
  registrationStatus,
  uiStatus,
  isStale,
  isOffline,
  lastStatusAtIso,
  connectors,
}: Props) {
  const pills: Pill[] = [];

  // Registration status — always shown when StEvE returned one; otherwise the
  // "registration unknown" pill signals the StEvE fetch failed or the charger
  // has never fully registered.
  if (registrationStatus) {
    pills.push({
      label: registrationStatus,
      tone: registrationStatus === "Accepted"
        ? "emerald"
        : registrationStatus === "Pending"
        ? "amber"
        : "rose",
      title: `StEvE registration status: ${registrationStatus}`,
    });
  } else {
    pills.push({
      label: "Registration unknown",
      tone: "muted",
      dashed: true,
      title: "StEvE did not return a registration status",
    });
  }

  // Online / offline / stale derivation — we key off the normalized UI status
  // so the pill always agrees with the big live-status card below.
  if (isOffline || uiStatus === "Offline") {
    pills.push({
      label: `Offline — last heard ${formatRelative(lastStatusAtIso)}`,
      tone: "rose",
      dashed: true,
      title: "No heartbeat for > 1h",
      live: true,
    });
  } else if (isStale) {
    pills.push({
      label: `Stale — ${formatRelative(lastStatusAtIso)}`,
      tone: "amber",
      dashed: true,
      title: "No heartbeat for > 10 min",
    });
  } else {
    pills.push({
      label: `Online — ${formatRelative(lastStatusAtIso)}`,
      tone: "emerald",
      live: true,
    });
  }

  pills.push({
    label: summarizeConnectors(connectors),
    tone: "neutral",
  });

  return (
    <div class="flex flex-col gap-3">
      {
        /* chargeBoxId (mono). Copy control lives on the identity card below so
       *  this server component stays island-free. */
      }
      <div class="flex items-center gap-2">
        <code class="rounded border bg-muted/40 px-2 py-0.5 font-mono text-xs">
          {chargeBoxId}
        </code>
      </div>

      <StatusPillRow pills={pills} />
    </div>
  );
}

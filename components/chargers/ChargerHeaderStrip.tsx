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
  /** Admin-set human label; falls back to `chargeBoxId` for display. */
  friendlyName: string | null;
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
  friendlyName,
  registrationStatus,
  uiStatus,
  isStale,
  isOffline,
  lastStatusAtIso,
  connectors,
}: Props) {
  const pills: Pill[] = [];

  // Registration status. If the charger row exists in `chargers_cache`
  // we treat it as implicitly registered (StEvE is the source of truth
  // for charger registration — there is no separate ExpresSync flow).
  // Only surface a pill when StEvE explicitly reported a non-Accepted
  // state, which is the actionable signal: a "Pending" or "Rejected"
  // charger needs admin attention. "Accepted" and absent both mean
  // "fine, nothing to do" — no pill.
  if (registrationStatus === "Pending") {
    pills.push({
      label: "Pending registration",
      tone: "amber",
      title: "StEvE registration status: Pending",
    });
  } else if (registrationStatus === "Rejected") {
    pills.push({
      label: "Registration rejected",
      tone: "rose",
      dashed: true,
      title: "StEvE registration status: Rejected",
    });
  }

  // Online / offline / stale derivation — we key off the normalized UI status
  // so the pill always agrees with the big live-status card below. When the
  // charger is currently online we don't append a "last seen" timestamp:
  // it's online RIGHT NOW, the relative time would just be misleading.
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
      label: "Online",
      tone: "emerald",
      live: true,
    });
  }

  pills.push({
    label: summarizeConnectors(connectors),
    tone: "neutral",
  });

  // Display name: prefer the admin-set friendlyName, fall back to the
  // chargeBoxId. The mono chip below it shows the technical identifier
  // (still valuable for support / debugging) only when the friendlyName
  // is set — otherwise the chip would just duplicate the heading.
  const displayName = friendlyName?.trim() || chargeBoxId;
  const showIdChip = !!friendlyName?.trim();

  return (
    <div class="flex flex-col gap-3">
      <div class="flex items-baseline gap-2">
        <span class="text-sm font-semibold tracking-tight">{displayName}</span>
        {showIdChip && (
          <code class="rounded border bg-muted/40 px-2 py-0.5 font-mono text-xs text-muted-foreground">
            {chargeBoxId}
          </code>
        )}
      </div>

      <StatusPillRow pills={pills} />
    </div>
  );
}

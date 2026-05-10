/**
 * Server-rendered header strip for `/chargers/[chargeBoxId]`. Replaces
 * the old strip + the standalone `ChargerLiveStatusCard` after the
 * 2026-05 redesign — the strip now carries the live-status info too.
 *
 * Visual: a single-line band sitting above the hero card. Left side is
 * a wrapping pill row + last-heartbeat. Right side is an island
 * (`ChargerStatusStripActions`) that owns the Refresh button and the
 * active-session mini-summary; we keep the actions in a separate
 * island so the bulk of the strip stays server-rendered.
 *
 * Pill semantics:
 *   - Online / Stale / Offline (managed only) — derived from
 *     `lastStatusAt` freshness. Unmanaged chargers always show `Online`.
 *   - Registration status (Pending / Rejected) — only when StEvE
 *     reports a non-Accepted state. Hidden on unmanaged.
 *   - Connector roll-up ("1 Available · 1 Charging") — hidden on
 *     unmanaged (no live OCPP status to report).
 *   - Unmanaged tag — only on unmanaged.
 */

import { type Pill, StatusPillRow } from "@/components/tags/StatusPillRow.tsx";
import { formatRelative } from "@/islands/shared/device-visuals.ts";
import ChargerStatusStripActions, {
  type ChargerActiveSessionSummary,
} from "@/islands/charger-actions/ChargerStatusStripActions.tsx";

interface ConnectorSummary {
  uiStatus: string;
}

interface Props {
  chargeBoxId: string;
  isUnmanaged: boolean;
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
  /** Active session info for the right-side mini-summary. Null when
   *  no session is running. */
  activeSession: ChargerActiveSessionSummary | null;
  /** When true the StEvE-failed banner shows below the strip; we
   *  surface this separately so it doesn't compete with pills. */
  steveFetchFailed: boolean;
}

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
  isUnmanaged,
  registrationStatus,
  uiStatus,
  isStale,
  isOffline,
  lastStatusAtIso,
  connectors,
  activeSession,
  steveFetchFailed,
}: Props) {
  const pills: Pill[] = [];

  if (isUnmanaged) {
    // Unmanaged chargers don't speak OCPP, so they don't have an
    // "offline" concept — they're always reachable via the public
    // sticker URL. A single "Online" pill + "Unmanaged" tag tells the
    // operator everything they need.
    pills.push({ label: "Online", tone: "emerald", live: true });
    pills.push({ label: "Unmanaged", tone: "sky" });
  } else {
    // Registration status — only when actionable.
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

    // Online / offline / stale — keyed off the normalized UI status so
    // the pill always agrees with the connector cards below.
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
      pills.push({ label: "Online", tone: "emerald", live: true });
    }

    pills.push({
      label: summarizeConnectors(connectors),
      tone: "neutral",
    });
  }

  return (
    <div class="flex flex-col gap-2">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex flex-wrap items-center gap-3">
          <StatusPillRow pills={pills} variant="bare" />
          {!isUnmanaged && (
            <span class="text-xs text-muted-foreground">
              Last heartbeat {formatRelative(lastStatusAtIso)}
            </span>
          )}
        </div>
        {!isUnmanaged && (
          <ChargerStatusStripActions
            chargeBoxId={chargeBoxId}
            activeSession={activeSession}
          />
        )}
      </div>
      {steveFetchFailed && (
        <div
          role="alert"
          class="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300"
        >
          <span aria-hidden="true">⚠</span>
          <span>
            StEvE is unreachable — live status below is from the local cache and
            may be out of date.
          </span>
        </div>
      )}
    </div>
  );
}

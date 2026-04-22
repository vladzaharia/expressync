/**
 * Shared visual helpers for charger-related islands and pages.
 *
 * Extracted from `islands/ChargerCard.tsx` so the Charge Box Details page
 * (`routes/chargers/[chargeBoxId].tsx`), its new `ConnectorCard` island,
 * and the existing `ChargerCard` can all speak the same status vocabulary.
 *
 * Keep in sync with any new OCPP status buckets; Lago / StEvE status strings
 * come in raw and we collapse them here.
 */

/**
 * The canonical UI buckets our pages display. Every OCPP status string gets
 * mapped to one of these via `normalizeStatus`; everything downstream (halo
 * color, pill label, icon) keys off this union.
 */
export type UiStatus =
  | "Available"
  | "Charging"
  | "Reserved"
  | "Offline"
  | "Faulted"
  | "Unavailable";

/**
 * Halo colors for the Wallbox / connector icon — the icon's LED ring IS the
 * status indicator (no separate dot). oklch triplets stay consistent across
 * light/dark themes.
 */
export const STATUS_HALO: Record<UiStatus, string> = {
  Available: "oklch(0.72 0.14 230)", // azure blue
  Charging: "oklch(0.72 0.18 145)", // green
  Reserved: "oklch(0.82 0.17 85)", // amber
  Unavailable: "oklch(0.82 0.17 85)", // amber
  Offline: "oklch(0.65 0.22 25)", // red
  Faulted: "oklch(0.65 0.22 25)", // red
};

/** After 10 min without a fresh status we dim the card; after 1 h we force
 *  the Offline bucket regardless of cached value. */
export const STALE_DIM_MS = 10 * 60 * 1000;
export const OFFLINE_AFTER_MS = 60 * 60 * 1000;
/** Client-side cooldown between manual "Refresh from StEvE" clicks. */
export const REFRESH_COOLDOWN_MS = 10_000;

/**
 * Collapse a raw OCPP status + last-heard-from timestamp + live-session flag
 * into one of the 6 `UiStatus` buckets.
 */
export function normalizeStatus(
  raw: string | null,
  lastStatusAtIso: string | null,
  hasActiveSession: boolean,
): UiStatus {
  if (lastStatusAtIso) {
    const age = Date.now() - new Date(lastStatusAtIso).getTime();
    if (age > OFFLINE_AFTER_MS) return "Offline";
  }

  if (hasActiveSession) return "Charging";
  if (!raw) return "Offline";

  const s = raw.toLowerCase();
  if (s.includes("charg")) return "Charging";
  if (s.includes("reserv")) return "Reserved";
  if (s.includes("fault") || s.includes("error")) return "Faulted";
  if (s.includes("unavail") || s.includes("suspended")) return "Unavailable";
  if (s.includes("avail") || s === "preparing" || s === "finishing") {
    return "Available";
  }
  return "Offline";
}

/** "5m ago" / "2h ago" / "3d ago" — reused by the identity card, recent tx
 *  list, and the operation audit log. */
export function formatRelative(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return "just now";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

/** "3d 4h" / "2h 15m" — first-seen / uptime badge. */
export function formatUptime(firstSeenIso: string): string {
  const diff = Date.now() - new Date(firstSeenIso).getTime();
  if (diff < 0) return "—";
  const totalMin = Math.floor(diff / 60000);
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  const minutes = totalMin % 60;
  return `${hours}h ${minutes}m`;
}

/** "12 min" / "1h 34m" — live session duration on a connector card. */
export function formatSessionDuration(startIso: string): string {
  const diff = Date.now() - new Date(startIso).getTime();
  if (diff < 0) return "0 min";
  const totalMin = Math.floor(diff / 60000);
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${m}m`;
}

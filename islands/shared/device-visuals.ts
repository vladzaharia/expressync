/**
 * Shared visual helpers for device-related islands and pages.
 *
 * Originally extracted from `islands/ChargerCard.tsx` (then named
 * `charger-visuals.ts`) so the Charge Box Details page
 * (`routes/chargers/[chargeBoxId].tsx`), its `ConnectorCard` island, and the
 * existing `ChargerCard` could all speak the same status vocabulary.
 *
 * As the system grew to cover phone/laptop NFC tap-targets alongside
 * chargers, the file was renamed to `device-visuals.ts` and grew a small
 * device-status surface (`normalizeDeviceStatus`, `DEVICE_STATUS_HALO`)
 * sitting next to the unchanged charger-status surface (`normalizeStatus`,
 * `STATUS_HALO`).
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

/**
 * Canonical "h:mm" elapsed-time format used everywhere a live charging
 * session shows duration. Always pads minutes to two digits so the value
 * doesn't shift width as the session progresses ("0:09" → "0:10").
 *
 * Examples: 0:12, 1:34, 23:05.
 *
 * For sessions running > 24h we keep the hour count growing (no day
 * rollover) so operators reading a chart don't lose context.
 */
export function formatSessionDuration(startIso: string): string {
  const diff = Date.now() - new Date(startIso).getTime();
  if (diff < 0) return "0:00";
  const totalMin = Math.floor(diff / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}:${m.toString().padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Generic device-status surface (chargers + phones + laptops + future kinds)
//
// This is intentionally smaller and simpler than the OCPP-specific
// `UiStatus` / `normalizeStatus` pair above: device "status" only needs to
// answer one question for the operator — is this thing reachable right now?
// — plus a transient "scanning" tone for the live arming window.
// ---------------------------------------------------------------------------

/**
 * The canonical UI buckets used by the generic Devices surface (admin
 * Devices page, the scan-modal device picker, anywhere a phone/laptop or
 * non-OCPP charger row is rendered).
 *
 * Mapping:
 *   - "Online"   — server has a recent heartbeat (`isOnline === true`).
 *   - "Offline"  — no fresh heartbeat OR last seen > `OFFLINE_AFTER_MS` ago.
 *   - "Scanning" — the device is mid-NFC-arm; this is a transient tone
 *                  callers opt into (e.g. `DEVICE_STATUS_HALO.Scanning`
 *                  while a scan-stream session is open). The
 *                  `normalizeDeviceStatus()` helper itself only ever
 *                  returns "Online" / "Offline" — callers layer "Scanning"
 *                  on top when they have that signal.
 */
export type DeviceStatus = "Online" | "Offline" | "Scanning";

/**
 * Halo colors for the generic device-icon ring. Mirrors `STATUS_HALO`'s
 * oklch palette so the chargers page and the devices page sit in the same
 * visual key.
 *
 *   - Online   → teal (matches the `accentTeal` design token used by the
 *                Devices page in 40-frontend.md)
 *   - Offline  → red (same as charger Offline/Faulted)
 *   - Scanning → cyan (callers add the pulse animation themselves; the
 *                color is the only thing this map fixes)
 */
export const DEVICE_STATUS_HALO: Record<DeviceStatus, string> = {
  Online: "oklch(0.72 0.14 196)", // teal
  Offline: "oklch(0.65 0.22 25)", // red
  Scanning: "oklch(0.80 0.15 200)", // cyan pulse
};

/**
 * Collapse `(lastSeenAtIso, isOnline)` into the generic `Online`/`Offline`
 * bucket. We honor `OFFLINE_AFTER_MS` even when the server says "online" so
 * a stale heartbeat (e.g. the SSE stream just dropped) doesn't read as live
 * forever.
 *
 * The "Scanning" bucket is never returned from this helper — it's a
 * transient tone callers apply directly when they know a scan-stream is
 * armed for the device.
 */
export function normalizeDeviceStatus(
  lastSeenAtIso: string | null,
  isOnline: boolean,
): DeviceStatus {
  if (lastSeenAtIso) {
    const age = Date.now() - new Date(lastSeenAtIso).getTime();
    if (age > OFFLINE_AFTER_MS) return "Offline";
  } else if (!isOnline) {
    return "Offline";
  }
  return isOnline ? "Online" : "Offline";
}

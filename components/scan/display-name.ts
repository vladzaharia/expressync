/**
 * Display-name helper for tap-target entries.
 *
 * The unified scan picker, the armed-state step copy, and the
 * `Using <label> to scan…` auto-pick line all need to render a
 * tap-target's name in the same way. The rules are:
 *
 *   - If the admin set a `friendlyName`, that's the name. Use it
 *     verbatim.
 *   - Otherwise, render a kind-prefixed fallback so an unnamed
 *     target still reads as "a charger" / "a phone" / "a laptop"
 *     instead of dumping a raw `chargeBoxId` or device UUID into
 *     the heading. We append the last 6 chars of the id so the
 *     operator can still distinguish two unnamed peers at a glance.
 *
 * Centralised so all three call sites stay in sync.
 */

import type { TapTargetEntry } from "@/src/lib/types/devices.ts";

/**
 * Render the display name for a tap target. `null` is acceptable —
 * the picker passes a not-yet-resolved target during the connecting
 * frame, in which case we return an empty string and the caller
 * decides whether to show a generic "the reader" placeholder.
 */
export function tapTargetDisplayName(
  target: TapTargetEntry | null | undefined,
): string {
  if (!target) return "";
  if (target.friendlyName) return target.friendlyName;
  return fallbackName(target);
}

function fallbackName(target: TapTargetEntry): string {
  const tail = shortId(target.deviceId);
  switch (target.kind) {
    case "charger":
      return tail ? `Charger ${tail}` : "Charger";
    case "phone_nfc":
      return tail ? `Phone ${tail}` : "Phone";
    case "laptop_nfc":
      return tail ? `Laptop ${tail}` : "Laptop";
    default:
      return tail ? `Device ${tail}` : "Device";
  }
}

/**
 * Last 6 chars of the id, uppercased, dash-stripped — chargeBoxIds
 * are already short, UUIDs become "ABCD12" instead of a 36-char wall.
 */
function shortId(id: string): string {
  const stripped = id.replace(/-/g, "").toUpperCase();
  if (stripped.length <= 6) return stripped;
  return stripped.slice(-6);
}

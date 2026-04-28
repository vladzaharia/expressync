import { cn } from "@/src/lib/utils/cn.ts";
import type { DeviceIconProps } from "@/src/lib/utils/device-icons.ts";

const SIZE_MAP = { sm: 32, md: 48, lg: 64 } as const;

function resolveSize(size: DeviceIconProps["size"]): number {
  return SIZE_MAP[size ?? "md"];
}

/**
 * iPhone tap-target icon — used as the device card's primary status indicator
 * for `kind === "phone_nfc"` rows.
 *
 * Visual key (mirrors `WallboxIcon.tsx` so chargers and phones sit in the
 * same family):
 *   - Matte dark body, rounded corners (~28% to read as a phone silhouette).
 *   - Inset halo ring around the body — same role as the Wallbox LED:
 *     status-bearing color, neutral body. Pass `haloColor` to color it.
 *   - Notch + speaker grill + camera lens for instant recognizability;
 *     deliberately understated so the status halo dominates.
 */
export function IPhoneIcon(
  { size = "md", haloColor = "oklch(0.72 0.14 196)", className }:
    DeviceIconProps,
) {
  const px = resolveSize(size);
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      class={cn("inline-block", className)}
    >
      {
        /* Halo outer diffuse glow (LED bleed) — drawn first so the body
          covers the inner edge */
      }
      <rect
        x="26"
        y="6"
        width="48"
        height="88"
        rx="14"
        ry="14"
        fill="none"
        stroke={haloColor}
        stroke-width="2"
        opacity="0.4"
      />
      {
        /* Body — rounded rectangle, fixed dark grey so the halo color is
          always legible */
      }
      <rect
        x="28"
        y="8"
        width="44"
        height="84"
        rx="12"
        ry="12"
        fill="oklch(0.28 0.01 250)"
      />
      {/* Subtle highlight edge for a bit of dimension */}
      <rect
        x="29"
        y="9"
        width="42"
        height="82"
        rx="11"
        ry="11"
        fill="none"
        stroke="oklch(0.42 0.01 250)"
        stroke-width="0.6"
      />
      {/* Halo ring — the status-bearing LED, traced just inside the body */}
      <rect
        x="31"
        y="11"
        width="38"
        height="78"
        rx="10"
        ry="10"
        fill="none"
        stroke={haloColor}
        stroke-width="5"
        opacity="0.95"
      />
      {/* Screen — darker recessed panel */}
      <rect
        x="34"
        y="16"
        width="32"
        height="68"
        rx="6"
        ry="6"
        fill="oklch(0.18 0.01 250)"
      />
      {/* Notch */}
      <rect
        x="44"
        y="16"
        width="12"
        height="3.5"
        rx="1.75"
        ry="1.75"
        fill="oklch(0.12 0.01 250)"
      />
      {/* Speaker grill */}
      <rect
        x="46.5"
        y="17.25"
        width="7"
        height="1"
        rx="0.5"
        ry="0.5"
        fill="oklch(0.32 0.01 250)"
      />
      {/* Camera lens */}
      <circle cx="42.5" cy="17.75" r="0.7" fill="oklch(0.32 0.01 250)" />
    </svg>
  );
}

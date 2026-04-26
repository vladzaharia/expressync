/**
 * CapabilityPill — small badge listing a single capability for a device.
 *
 * Used on the Devices admin page (detail "Capabilities" SectionCard) and the
 * Devices listing row to communicate, at a glance, what a given device can
 * do today (`tap`, `ev`, future kinds). Renders one pill per capability so
 * a row can carry many without rebuilding a custom variant each time.
 *
 * Tone map:
 *   - `tap`  → teal     (matches `accentTeal` on the Devices page)
 *   - `ev`   → orange   (matches the Chargers accent)
 *   - other  → slate    (neutral fallback)
 *
 * The pill is decorative (no interactive affordances). Pass `class` to
 * override spacing in dense rows.
 */
import { BatteryCharging, Smartphone } from "lucide-preact";
import { cn } from "@/src/lib/utils/cn.ts";

/** Known capabilities. Adding a new one: extend this union, the
 *  `CAPABILITY_TONE` map, the `CAPABILITY_LABEL` map, and (optionally)
 *  the icon switch in `renderIcon` below. */
export type Capability = "tap" | "ev";

const CAPABILITY_LABEL: Record<Capability, string> = {
  tap: "Tap",
  ev: "EV",
};

function renderIcon(capability: Capability) {
  switch (capability) {
    case "tap":
      return <Smartphone aria-hidden class="size-3" />;
    case "ev":
      return <BatteryCharging aria-hidden class="size-3" />;
  }
}

/**
 * Tone classes — wash + border + text. The keys here match the accents
 * used by `PageCard colorScheme` so a Devices page (`teal`) and the
 * Chargers page (`orange`) read as a family.
 */
const CAPABILITY_TONE: Record<Capability | "unknown", string> = {
  tap: "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-300",
  ev:
    "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  unknown:
    "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300",
};

interface CapabilityPillProps {
  capability: Capability | string;
  /** Show the lucide glyph beside the label. Defaults to `true`. */
  showIcon?: boolean;
  /** Override the displayed label (otherwise uses the canonical label). */
  label?: string;
  class?: string;
}

export function CapabilityPill(
  { capability, showIcon = true, label, class: className }: CapabilityPillProps,
) {
  const known = capability === "tap" || capability === "ev";
  const tone = known
    ? CAPABILITY_TONE[capability as Capability]
    : CAPABILITY_TONE.unknown;
  const text = label ??
    (known ? CAPABILITY_LABEL[capability as Capability] : capability);

  return (
    <span
      class={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        tone,
        className,
      )}
    >
      {showIcon && known && renderIcon(capability as Capability)}
      <span>{text}</span>
    </span>
  );
}

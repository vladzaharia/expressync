/**
 * CapabilityPill — small badge listing a single capability for a device.
 *
 * Used on the Devices admin page (detail "Capabilities" SectionCard) and the
 * Devices listing row to communicate, at a glance, what a given device can
 * do today (`scanner`, `charger`, `user`, `kiosk`). Renders one pill per
 * capability so a row can carry many without rebuilding a custom variant
 * each time.
 *
 * Tone map:
 *   - `scanner` → teal     (matches `accentTeal` on the Devices page)
 *   - `charger` → orange   (matches the Chargers accent)
 *   - `user`    → cyan     (matches the customer "use" surfaces)
 *   - `kiosk`   → violet   (single-purpose appliance)
 *   - other     → slate    (neutral fallback)
 *
 * The pill is decorative (no interactive affordances). Pass `class` to
 * override spacing in dense rows.
 */
import { BatteryCharging, Lock, Smartphone, User } from "lucide-preact";
import { cn } from "@/src/lib/utils/cn.ts";

/** Known capabilities. Adding a new one: extend this union, the
 *  `CAPABILITY_TONE` map, the `CAPABILITY_LABEL` map, and (optionally)
 *  the icon switch in `renderIcon` below. */
export type Capability = "scanner" | "charger" | "user" | "kiosk";

const CAPABILITY_LABEL: Record<Capability, string> = {
  scanner: "Scanner",
  charger: "Charger",
  user: "User",
  kiosk: "Kiosk",
};

function renderIcon(capability: Capability) {
  switch (capability) {
    case "scanner":
      return <Smartphone aria-hidden class="size-3" />;
    case "charger":
      return <BatteryCharging aria-hidden class="size-3" />;
    case "user":
      return <User aria-hidden class="size-3" />;
    case "kiosk":
      return <Lock aria-hidden class="size-3" />;
  }
}

/**
 * Tone classes — wash + border + text. The keys here match the accents
 * used by `PageCard colorScheme` so a Devices page (`teal`) and the
 * Chargers page (`orange`) read as a family.
 */
const CAPABILITY_TONE: Record<Capability | "unknown", string> = {
  scanner: "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-300",
  charger:
    "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  user: "border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
  kiosk:
    "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  unknown:
    "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300",
};

const KNOWN_CAPABILITIES: ReadonlySet<Capability> = new Set([
  "scanner",
  "charger",
  "user",
  "kiosk",
]);

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
  const known = KNOWN_CAPABILITIES.has(capability as Capability);
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

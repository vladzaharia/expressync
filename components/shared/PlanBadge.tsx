/**
 * PlanBadge — compact colored pill for a Lago plan / subscription.
 *
 * Canonical inline display for "which plan is this tag / customer / row on?"
 * Use this anywhere subscription.name or plan.name would otherwise render
 * as plain text. Keeps plan display consistent with the accent system
 * already used by the dashboard's `PlanInfoCard` and `StatStrip` tints.
 *
 * Accent can be passed explicitly; when omitted, it's derived from a stable
 * hash of the plan code/name so the same plan always gets the same color
 * across the app without a central registry.
 */

import { BadgeCheck } from "lucide-preact";
import { type AccentColor, stripToneClasses } from "@/src/lib/colors.ts";
import { cn } from "@/src/lib/utils/cn.ts";

// Palette used for auto-assigned plan colors. Picks from the saturated
// accents — skips `muted` / destructives so every plan reads as "active".
const AUTO_ACCENTS: AccentColor[] = [
  "blue",
  "teal",
  "violet",
  "cyan",
  "green",
  "indigo",
  "orange",
  "amber",
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

export function resolvePlanAccent(
  key: string | null | undefined,
  override?: AccentColor,
): AccentColor {
  if (override) return override;
  if (!key) return "muted" as AccentColor;
  return AUTO_ACCENTS[hashString(key) % AUTO_ACCENTS.length];
}

interface Props {
  /** Human-friendly label — plan name or plan code. */
  name: string | null | undefined;
  /** Stable key for color derivation — plan code is best. Falls back to name. */
  planCode?: string | null;
  /** Explicit accent override; skips hash-based derivation. */
  accent?: AccentColor;
  /** Render compact (tag-cell sized) vs. default. */
  size?: "sm" | "md";
  /** Optional subtitle rendered below the name (e.g. "Free · 50 kWh"). */
  subtitle?: string;
  /** Show the verified check glyph on the left. */
  showIcon?: boolean;
  className?: string;
}

export function PlanBadge(
  {
    name,
    planCode,
    accent,
    size = "md",
    subtitle,
    showIcon = true,
    className,
  }: Props,
) {
  if (!name) {
    return (
      <span
        class={cn(
          "inline-flex items-center gap-1 rounded-full px-2 py-0.5",
          "text-[11px] font-medium text-muted-foreground bg-muted/50 border",
          className,
        )}
      >
        No plan
      </span>
    );
  }

  const key = planCode ?? name;
  const resolved = resolvePlanAccent(key, accent);
  const tone = stripToneClasses[resolved];
  // Pull the bg + text classes out of the existing accent palette so this
  // component reuses the same tinting already applied to StatStrip cells
  // and SectionCard headers — no new color decisions.
  const bg = tone.iconWell.split(" ").find((c) => c.startsWith("bg-")) ??
    "bg-primary/10";
  const text = tone.iconWell.split(" ").find((c) => c.startsWith("text-")) ??
    "text-primary";
  const border = tone.cell.split(" ").find((c) => c.startsWith("border-")) ??
    "border-primary/20";

  const padY = size === "sm" ? "py-0.5" : "py-1";
  const padX = size === "sm" ? "px-2" : "px-2.5";
  const textSize = size === "sm" ? "text-[11px]" : "text-xs";

  return (
    <span
      class={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-medium whitespace-nowrap",
        padX,
        padY,
        textSize,
        bg,
        text,
        border,
        className,
      )}
      title={name}
    >
      {showIcon && <BadgeCheck class="size-3 shrink-0" aria-hidden="true" />}
      <span class="truncate max-w-[14rem]">{name}</span>
      {subtitle && <span class="opacity-70 font-normal">· {subtitle}</span>}
    </span>
  );
}

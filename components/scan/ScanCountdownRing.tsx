/**
 * ScanCountdownRing — SVG radial countdown used in the `waiting` state of
 * the Scan Tag modal. The stroke-dashoffset transition is disabled when
 * the user prefers reduced motion; in that mode we only render the numeric
 * label.
 */

import type { AccentColor } from "@/src/lib/colors.ts";
import { cn } from "@/src/lib/utils/cn.ts";

interface Props {
  remaining: number;
  total: number;
  /**
   * Ring tone. Any accent colour is accepted; the page-level accent is
   * normally passed through, with `amber` taking over when the countdown
   * is close to expiring (warning semantic).
   */
  tone?: AccentColor;
  /** Pass `true` to skip the animated stroke. Defaults to false. */
  reducedMotion?: boolean;
  class?: string;
}

const RADIUS = 56;
const CIRC = 2 * Math.PI * RADIUS;

/**
 * Static class maps so Tailwind's JIT picks them up. Enumerate every accent
 * used by the scan modal (and callers that theme it via `accent`).
 */
const trackClass: Record<AccentColor, string> = {
  red: "text-red-500/20",
  orange: "text-orange-500/20",
  amber: "text-amber-500/20",
  yellow: "text-yellow-500/20",
  lime: "text-lime-500/20",
  green: "text-green-500/20",
  emerald: "text-emerald-500/20",
  teal: "text-teal-500/20",
  cyan: "text-cyan-500/20",
  sky: "text-sky-500/20",
  blue: "text-blue-500/20",
  indigo: "text-indigo-500/20",
  violet: "text-violet-500/20",
  purple: "text-purple-500/20",
  fuchsia: "text-fuchsia-500/20",
  pink: "text-pink-500/20",
  rose: "text-rose-500/20",
  slate: "text-slate-500/20",
};

const strokeClass: Record<AccentColor, string> = {
  red: "text-red-500",
  orange: "text-orange-500",
  amber: "text-amber-500",
  yellow: "text-yellow-500",
  lime: "text-lime-500",
  green: "text-green-500",
  emerald: "text-emerald-500",
  teal: "text-teal-500",
  cyan: "text-cyan-500",
  sky: "text-sky-500",
  blue: "text-blue-500",
  indigo: "text-indigo-500",
  violet: "text-violet-500",
  purple: "text-purple-500",
  fuchsia: "text-fuchsia-500",
  pink: "text-pink-500",
  rose: "text-rose-500",
  slate: "text-slate-500",
};

const labelClass: Record<AccentColor, string> = {
  red: "text-red-600 dark:text-red-400",
  orange: "text-orange-600 dark:text-orange-400",
  amber: "text-amber-600 dark:text-amber-400",
  yellow: "text-yellow-600 dark:text-yellow-400",
  lime: "text-lime-600 dark:text-lime-400",
  green: "text-green-600 dark:text-green-400",
  emerald: "text-emerald-600 dark:text-emerald-400",
  teal: "text-teal-600 dark:text-teal-400",
  cyan: "text-cyan-600 dark:text-cyan-400",
  sky: "text-sky-600 dark:text-sky-400",
  blue: "text-blue-600 dark:text-blue-400",
  indigo: "text-indigo-600 dark:text-indigo-400",
  violet: "text-violet-600 dark:text-violet-400",
  purple: "text-purple-600 dark:text-purple-400",
  fuchsia: "text-fuchsia-600 dark:text-fuchsia-400",
  pink: "text-pink-600 dark:text-pink-400",
  rose: "text-rose-600 dark:text-rose-400",
  slate: "text-slate-600 dark:text-slate-400",
};

export function ScanCountdownRing({
  remaining,
  total,
  tone = "cyan",
  reducedMotion = false,
  class: className,
}: Props) {
  const pct = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0;
  const dashoffset = CIRC - pct * CIRC;

  return (
    <div
      class={cn("relative inline-flex items-center justify-center", className)}
      role="img"
      aria-label={`${remaining} seconds remaining`}
    >
      <svg class="size-32 -rotate-90" viewBox="0 0 128 128" aria-hidden="true">
        <circle
          cx="64"
          cy="64"
          r={RADIUS}
          fill="none"
          stroke="currentColor"
          stroke-width="6"
          class={trackClass[tone]}
        />
        {!reducedMotion && (
          <circle
            cx="64"
            cy="64"
            r={RADIUS}
            fill="none"
            stroke="currentColor"
            stroke-width="6"
            stroke-linecap="round"
            class={cn(
              "transition-[stroke-dashoffset] duration-500",
              strokeClass[tone],
            )}
            style={{
              strokeDasharray: CIRC,
              strokeDashoffset: dashoffset,
            }}
          />
        )}
      </svg>
      <span
        class={cn(
          "absolute inset-0 flex items-center justify-center text-2xl font-semibold tabular-nums",
          labelClass[tone],
        )}
      >
        {remaining}s
      </span>
    </div>
  );
}

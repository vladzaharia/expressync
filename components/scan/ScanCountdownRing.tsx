/**
 * ScanCountdownRing — SVG radial countdown used in the `waiting` state of
 * the Scan Tag modal. The stroke-dashoffset transition is disabled when
 * the user prefers reduced motion; in that mode we only render the numeric
 * label.
 */

import { cn } from "@/src/lib/utils/cn.ts";

interface Props {
  remaining: number;
  total: number;
  /**
   * Visual tone. `violet` is the default (waiting state); `amber` is used
   * when the timer is close to expiring to draw the operator's eye.
   */
  tone?: "violet" | "amber" | "emerald";
  /** Pass `true` to skip the animated stroke. Defaults to false. */
  reducedMotion?: boolean;
  class?: string;
}

const RADIUS = 56;
const CIRC = 2 * Math.PI * RADIUS;

export function ScanCountdownRing({
  remaining,
  total,
  tone = "violet",
  reducedMotion = false,
  class: className,
}: Props) {
  const pct = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0;
  const dashoffset = CIRC - pct * CIRC;

  const trackClass = tone === "amber"
    ? "text-amber-500/20"
    : tone === "emerald"
    ? "text-emerald-500/20"
    : "text-violet-500/20";
  const strokeClass = tone === "amber"
    ? "text-amber-500"
    : tone === "emerald"
    ? "text-emerald-500"
    : "text-violet-500";

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
          class={trackClass}
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
              strokeClass,
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
          tone === "amber"
            ? "text-amber-600 dark:text-amber-400"
            : tone === "emerald"
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-violet-600 dark:text-violet-400",
        )}
      >
        {remaining}s
      </span>
    </div>
  );
}

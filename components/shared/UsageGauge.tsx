/**
 * UsageGauge — 180° half-donut SVG gauge.
 *
 * Polaris Track G — canonical "consumption vs cap" visualisation. Used by
 * `UsageGaugeLive` on the customer Billing page (current-period kWh) and
 * potentially the dashboard hero in Track G1.
 *
 * Rendering:
 *   - Half-donut arc swept from 180° (left) to 360° (right), with the
 *     center text showing `value / cap unit` and an optional caption.
 *   - Color zones key off the percentage of cap consumed:
 *       0–75%   → blue   (text-blue-500)
 *       75–100% → amber  (text-amber-500)
 *       >100%   → rose   (text-rose-500)
 *   - When `cap` is null/0 the arc renders un-filled and the center reads
 *     the raw value with no ratio. Empty state (`value === 0 && !cap`)
 *     shows a faded arc + "No usage yet" caption.
 *   - Animation: the foreground arc's `stroke-dasharray` animates from 0
 *     → target on first paint (800ms ease-out). `prefers-reduced-motion`
 *     skips the animation.
 *
 * Accent override:
 *   - Pass `accent="teal"` (or any `AccentColor`) to force a tone that
 *     matches the surrounding page accent regardless of the percentage
 *     band — useful when the gauge is purely decorative ("subscription
 *     summary" rather than "approaching limit alert").
 */

import { useEffect, useState } from "preact/hooks";
import { cn } from "@/src/lib/utils/cn.ts";
import { type AccentColor, accentTailwindClasses } from "@/src/lib/colors.ts";

interface UsageGaugeProps {
  /** Consumed value in `unit`. */
  value: number;
  /** Optional cap. When omitted, gauge renders as a full arc with the value text. */
  cap?: number | null;
  /** Unit label appended after the value (e.g. "kWh"). */
  unit?: string;
  /** Caption rendered under the value (e.g. "this month"). */
  caption?: string;
  /**
   * When set, overrides the threshold-based color and forces the gauge to
   * the page accent tone. Useful for the customer Billing page where the
   * teal accent is the page identity.
   */
  accent?: AccentColor;
  /** Extra classes merged onto the wrapping div. */
  className?: string;
  /** Override the SVG width — defaults to a responsive 200px. */
  size?: number;
}

const STROKE_WIDTH = 18;
const SVG_WIDTH = 200;
const SVG_HEIGHT = 120;

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "0";
  // Render up to 2 decimals but trim trailing zeros — "12.4" not "12.40".
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

/**
 * Pick the threshold-based tone unless the caller forced an accent.
 * The percentage drives the heat; accent overrides it for branding pages.
 */
function pickToneClass(
  pct: number,
  accent: AccentColor | undefined,
): string {
  if (accent) return accentTailwindClasses[accent].text;
  if (pct >= 1) return "text-rose-500";
  if (pct >= 0.75) return "text-amber-500";
  return "text-blue-500";
}

export function UsageGauge({
  value,
  cap,
  unit = "kWh",
  caption,
  accent,
  className,
  size = SVG_WIDTH,
}: UsageGaugeProps) {
  // SVG geometry — half-donut from 180° to 360° drawn as an arc.
  // (`cx` would be SVG_WIDTH / 2 but isn't needed since both endpoints sit
  // on the bottom edge at y=cy.)
  const cy = SVG_HEIGHT;
  const radius = (SVG_WIDTH - STROKE_WIDTH) / 2;
  const arcCircumference = Math.PI * radius;

  // Compute percentage of cap consumed.
  const ratio = cap && cap > 0 ? clamp01(value / cap) : 0;
  const hasCap = cap !== null && cap !== undefined && cap > 0;
  const isEmpty = value === 0 && !hasCap;

  // Animate the foreground arc on first mount. Prefers-reduced-motion users
  // skip the tween — they get the final state immediately.
  const [animatedRatio, setAnimatedRatio] = useState(0);
  useEffect(() => {
    if (
      typeof globalThis.matchMedia === "function" &&
      globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setAnimatedRatio(ratio);
      return;
    }
    // Use requestAnimationFrame for the initial tick so the 0 → ratio
    // transition runs after mount paint.
    const raf = requestAnimationFrame(() => setAnimatedRatio(ratio));
    return () => cancelAnimationFrame(raf);
  }, [ratio]);

  const dashOffset = arcCircumference * (1 - animatedRatio);
  const toneClass = pickToneClass(ratio, accent);

  // For the empty state we still want to show the arc track but faded so
  // the user understands where the gauge will fill once data flows in.
  const arcOpacity = isEmpty ? 0.3 : 1;

  return (
    <div
      className={cn(
        "relative inline-flex flex-col items-center",
        className,
      )}
      role="img"
      aria-label={hasCap
        ? `${formatNumber(value)} of ${formatNumber(cap!)} ${unit}`
        : `${formatNumber(value)} ${unit}`}
    >
      <svg
        width={size}
        height={size * (SVG_HEIGHT / SVG_WIDTH)}
        viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
        aria-hidden="true"
      >
        {/* Background track — neutral, always full half-arc. */}
        <path
          d={`M ${STROKE_WIDTH / 2} ${cy} A ${radius} ${radius} 0 0 1 ${
            SVG_WIDTH - STROKE_WIDTH / 2
          } ${cy}`}
          stroke="currentColor"
          strokeOpacity={0.15}
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          fill="none"
          className="text-muted-foreground"
        />
        {/* Foreground arc — animates from 0 to `ratio`. */}
        <path
          d={`M ${STROKE_WIDTH / 2} ${cy} A ${radius} ${radius} 0 0 1 ${
            SVG_WIDTH - STROKE_WIDTH / 2
          } ${cy}`}
          stroke="currentColor"
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={arcCircumference}
          strokeDashoffset={dashOffset}
          opacity={arcOpacity}
          className={cn(
            toneClass,
            "transition-[stroke-dashoffset] ease-out",
          )}
          style={{ transitionDuration: "800ms" }}
        />
      </svg>
      <div
        className="absolute inset-x-0 bottom-0 flex flex-col items-center"
        style={{ paddingBottom: "0.25rem" }}
      >
        {isEmpty
          ? (
            <p className="text-sm font-medium text-muted-foreground">
              No usage yet
            </p>
          )
          : (
            <>
              <p
                className={cn(
                  "text-xl font-semibold tabular-nums leading-tight",
                  toneClass,
                )}
              >
                {formatNumber(value)}
                {hasCap && (
                  <span className="text-muted-foreground">
                    {" / "}
                    {formatNumber(cap!)}
                  </span>
                )}{" "}
                <span className="text-sm font-normal text-muted-foreground">
                  {unit}
                </span>
              </p>
              {caption && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {caption}
                </p>
              )}
            </>
          )}
      </div>
    </div>
  );
}

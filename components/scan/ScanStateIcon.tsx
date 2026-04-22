/**
 * ScanStateIcon — maps a `ScanTagState` kind to its canonical Lucide glyph
 * and color token. Centralized here so the modal body and any future
 * in-page summary card render consistent iconography.
 *
 * Neutral states (idle/connecting/waiting/resolving/routing) pick up the
 * caller-supplied `accent`; semantic states (detected/timeout/errors) keep
 * their fixed semantic tone (emerald/amber/destructive) regardless of
 * accent so operators read them correctly at a glance.
 */

import {
  AlertTriangle,
  ArrowRight,
  CircleCheck,
  Clock,
  Loader2,
  Nfc,
  PlugZap,
  WifiOff,
} from "lucide-preact";
import type { ScanTagState } from "@/islands/shared/use-scan-tag.ts";
import { type AccentColor, stripToneClasses } from "@/src/lib/colors.ts";
import { cn } from "@/src/lib/utils/cn.ts";

interface Props {
  state: ScanTagState;
  /** Neutral-state tint. Defaults to cyan (the Tags page accent). */
  accent?: AccentColor;
  /** Extra classes merged onto the icon element. Size default is size-10. */
  class?: string;
}

/** Extract the `text-{accent}-600 dark:text-{accent}-400` half of an icon-well class. */
function accentTextClass(accent: AccentColor): string {
  const well = stripToneClasses[accent].iconWell;
  // Format: "bg-{c}-500/10 text-{c}-600 dark:text-{c}-400" — drop the bg-*.
  return well.split(" ").slice(1).join(" ");
}

export function ScanStateIcon(
  { state, accent = "cyan", class: className }: Props,
) {
  const base = cn("size-10", className);
  const accentText = accentTextClass(accent);
  switch (state.kind) {
    case "idle":
    case "connecting":
      return <Loader2 class={cn(base, accentText, "animate-spin")} />;
    case "waiting":
      return <Nfc class={cn(base, accentText)} />;
    case "detected":
      return <CircleCheck class={cn(base, "text-emerald-500")} />;
    case "resolving":
      return <Loader2 class={cn(base, accentText, "animate-spin")} />;
    case "routing":
      return <ArrowRight class={cn(base, accentText)} />;
    case "timeout":
      return <Clock class={cn(base, "text-amber-500")} />;
    case "unavailable":
      return <PlugZap class={cn(base, "text-destructive")} />;
    case "network_error":
      return <WifiOff class={cn(base, "text-destructive")} />;
    case "lookup_failed":
      return <AlertTriangle class={cn(base, "text-destructive")} />;
    case "dismissed":
      return null;
  }
}

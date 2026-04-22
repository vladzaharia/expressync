/**
 * ScanStateIcon — maps a `ScanTagState` kind to its canonical Lucide glyph
 * and color token. Centralized here so the modal body and any future
 * in-page summary card render consistent iconography.
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
import { cn } from "@/src/lib/utils/cn.ts";

interface Props {
  state: ScanTagState;
  /** Extra classes merged onto the icon element. Size default is size-10. */
  class?: string;
}

export function ScanStateIcon({ state, class: className }: Props) {
  const base = cn("size-10", className);
  switch (state.kind) {
    case "idle":
    case "connecting":
      return <Loader2 class={cn(base, "text-violet-500 animate-spin")} />;
    case "waiting":
      return <Nfc class={cn(base, "text-violet-500")} />;
    case "detected":
      return <CircleCheck class={cn(base, "text-emerald-500")} />;
    case "resolving":
      return <Loader2 class={cn(base, "text-violet-500 animate-spin")} />;
    case "routing":
      return <ArrowRight class={cn(base, "text-violet-500")} />;
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

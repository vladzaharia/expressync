/**
 * StatusBadge — canonical status chip used across the app.
 *
 * Props:
 *   tone   — one of the five tonal variants; maps to a Tailwind colour family.
 *   icon   — optional leading element (icon, colored dot, …).
 *   label  — visible label text.
 *   large  — when true, renders px-3 py-1 text-sm instead of the compact default.
 *
 * Tone → Tailwind class mapping:
 *   success      → emerald
 *   warning      → amber
 *   destructive  → rose
 *   info         → cyan
 *   muted        → plain border + muted foreground
 */

import type { ComponentChildren } from "preact";
import { cn } from "@/src/lib/utils/cn.ts";

export type StatusBadgeTone =
  | "success"
  | "warning"
  | "destructive"
  | "info"
  | "muted";

export interface StatusBadgeProps {
  tone: StatusBadgeTone;
  icon?: ComponentChildren;
  label: string;
  large?: boolean;
  className?: string;
  title?: string;
}

const TONE_CLASSES: Record<StatusBadgeTone, string> = {
  success:
    "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  warning:
    "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-400",
  destructive:
    "border-rose-500/40 bg-rose-500/15 text-rose-700 dark:text-rose-400",
  info: "border-cyan-500/40 bg-cyan-500/15 text-cyan-700 dark:text-cyan-400",
  muted: "border-border bg-background text-muted-foreground",
};

export function StatusBadge(
  { tone, icon, label, large, className, title }: StatusBadgeProps,
) {
  return (
    <span
      class={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-medium",
        large ? "px-3 py-1 text-sm" : "px-2.5 py-0.5 text-xs",
        TONE_CLASSES[tone],
        className,
      )}
      title={title ?? label}
    >
      {icon ? <span aria-hidden="true" class="inline-flex">{icon}</span> : null}
      <span>{label}</span>
    </span>
  );
}

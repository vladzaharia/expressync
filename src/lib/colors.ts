/**
 * Centralized accent color definitions for consistent theming across the app
 * Used by PageCard, SidebarLayout, SidebarWrapper, and AppSidebar
 */

// All available accent colors
export const ACCENT_COLORS = [
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
  "slate",
] as const;

export type AccentColor = (typeof ACCENT_COLORS)[number];

/**
 * Border beam gradient colors using oklch for vibrant, consistent colors
 * Each color has a "from" and "to" for the animated gradient
 */
export const borderBeamColors: Record<
  AccentColor,
  { from: string; to: string }
> = {
  red: {
    from: "oklch(0.65 0.25 25)", // Bright red
    to: "oklch(0.60 0.28 15)", // Deep red
  },
  orange: {
    from: "oklch(0.75 0.20 50)", // Bright orange
    to: "oklch(0.70 0.22 35)", // Deep orange
  },
  amber: {
    from: "oklch(0.80 0.18 75)", // Bright amber
    to: "oklch(0.75 0.20 60)", // Deep amber
  },
  yellow: {
    from: "oklch(0.90 0.15 95)", // Bright yellow
    to: "oklch(0.85 0.18 85)", // Deep yellow
  },
  lime: {
    from: "oklch(0.85 0.22 125)", // Bright lime
    to: "oklch(0.80 0.25 115)", // Deep lime
  },
  green: {
    from: "oklch(0.75 0.22 145)", // Volt green
    to: "oklch(0.70 0.20 155)", // Deep green
  },
  emerald: {
    from: "oklch(0.75 0.18 160)", // Bright emerald
    to: "oklch(0.70 0.20 170)", // Deep emerald
  },
  teal: {
    from: "oklch(0.75 0.15 180)", // Bright teal
    to: "oklch(0.70 0.18 190)", // Deep teal
  },
  cyan: {
    from: "oklch(0.80 0.15 200)", // Electric cyan
    to: "oklch(0.75 0.18 210)", // Deep cyan
  },
  sky: {
    from: "oklch(0.75 0.15 220)", // Bright sky
    to: "oklch(0.70 0.18 230)", // Deep sky
  },
  blue: {
    from: "oklch(0.70 0.18 240)", // Electric blue
    to: "oklch(0.65 0.22 250)", // Deep blue
  },
  indigo: {
    from: "oklch(0.65 0.22 265)", // Bright indigo
    to: "oklch(0.60 0.25 275)", // Deep indigo
  },
  violet: {
    from: "oklch(0.70 0.25 290)", // Bright violet
    to: "oklch(0.65 0.28 300)", // Magenta-violet
  },
  purple: {
    from: "oklch(0.65 0.28 305)", // Bright purple
    to: "oklch(0.60 0.30 315)", // Deep purple
  },
  fuchsia: {
    from: "oklch(0.70 0.28 320)", // Bright fuchsia
    to: "oklch(0.65 0.30 330)", // Deep fuchsia
  },
  pink: {
    from: "oklch(0.75 0.22 345)", // Bright pink
    to: "oklch(0.70 0.25 355)", // Deep pink
  },
  rose: {
    from: "oklch(0.70 0.22 10)", // Bright rose
    to: "oklch(0.65 0.25 0)", // Deep rose
  },
  slate: {
    from: "oklch(0.60 0.02 260)", // Bright slate
    to: "oklch(0.55 0.03 250)", // Deep slate
  },
};

/**
 * Tailwind CSS classes for accent colors
 * Used for backgrounds, text, hover states, and toggle states
 */
export const accentTailwindClasses: Record<
  AccentColor,
  {
    bg: string;
    bgHover: string;
    text: string;
    tooltip: string;
    toggleOn: string;
  }
> = {
  red: {
    bg: "bg-red-500/20",
    bgHover: "hover:bg-red-500/30",
    text: "text-red-600 dark:text-red-400",
    tooltip: "bg-red-500/90 text-white",
    toggleOn:
      "hover:text-red-600 dark:hover:text-red-400 data-[state=on]:bg-red-500/20 data-[state=on]:text-red-600 dark:data-[state=on]:text-red-400",
  },
  orange: {
    bg: "bg-orange-500/20",
    bgHover: "hover:bg-orange-500/30",
    text: "text-orange-600 dark:text-orange-400",
    tooltip: "bg-orange-500/90 text-white",
    toggleOn:
      "hover:text-orange-600 dark:hover:text-orange-400 data-[state=on]:bg-orange-500/20 data-[state=on]:text-orange-600 dark:data-[state=on]:text-orange-400",
  },
  amber: {
    bg: "bg-amber-500/20",
    bgHover: "hover:bg-amber-500/30",
    text: "text-amber-600 dark:text-amber-400",
    tooltip: "bg-amber-500/90 text-white",
    toggleOn:
      "hover:text-amber-600 dark:hover:text-amber-400 data-[state=on]:bg-amber-500/20 data-[state=on]:text-amber-600 dark:data-[state=on]:text-amber-400",
  },
  yellow: {
    bg: "bg-yellow-500/20",
    bgHover: "hover:bg-yellow-500/30",
    text: "text-yellow-600 dark:text-yellow-400",
    tooltip: "bg-yellow-500/90 text-white",
    toggleOn:
      "hover:text-yellow-600 dark:hover:text-yellow-400 data-[state=on]:bg-yellow-500/20 data-[state=on]:text-yellow-600 dark:data-[state=on]:text-yellow-400",
  },
  lime: {
    bg: "bg-lime-500/20",
    bgHover: "hover:bg-lime-500/30",
    text: "text-lime-600 dark:text-lime-400",
    tooltip: "bg-lime-500/90 text-white",
    toggleOn:
      "hover:text-lime-600 dark:hover:text-lime-400 data-[state=on]:bg-lime-500/20 data-[state=on]:text-lime-600 dark:data-[state=on]:text-lime-400",
  },
  green: {
    bg: "bg-green-500/20",
    bgHover: "hover:bg-green-500/30",
    text: "text-green-600 dark:text-green-400",
    tooltip: "bg-green-500/90 text-black",
    toggleOn:
      "hover:text-green-600 dark:hover:text-green-400 data-[state=on]:bg-green-500/20 data-[state=on]:text-green-600 dark:data-[state=on]:text-green-400",
  },
  emerald: {
    bg: "bg-emerald-500/20",
    bgHover: "hover:bg-emerald-500/30",
    text: "text-emerald-600 dark:text-emerald-400",
    tooltip: "bg-emerald-500/90 text-white",
    toggleOn:
      "hover:text-emerald-600 dark:hover:text-emerald-400 data-[state=on]:bg-emerald-500/20 data-[state=on]:text-emerald-600 dark:data-[state=on]:text-emerald-400",
  },
  teal: {
    bg: "bg-teal-500/20",
    bgHover: "hover:bg-teal-500/30",
    text: "text-teal-600 dark:text-teal-400",
    tooltip: "bg-teal-500/90 text-white",
    toggleOn:
      "hover:text-teal-600 dark:hover:text-teal-400 data-[state=on]:bg-teal-500/20 data-[state=on]:text-teal-600 dark:data-[state=on]:text-teal-400",
  },
  cyan: {
    bg: "bg-cyan-500/20",
    bgHover: "hover:bg-cyan-500/30",
    text: "text-cyan-600 dark:text-cyan-400",
    tooltip: "bg-cyan-500/90 text-white",
    toggleOn:
      "hover:text-cyan-600 dark:hover:text-cyan-400 data-[state=on]:bg-cyan-500/20 data-[state=on]:text-cyan-600 dark:data-[state=on]:text-cyan-400",
  },
  sky: {
    bg: "bg-sky-500/20",
    bgHover: "hover:bg-sky-500/30",
    text: "text-sky-600 dark:text-sky-400",
    tooltip: "bg-sky-500/90 text-white",
    toggleOn:
      "hover:text-sky-600 dark:hover:text-sky-400 data-[state=on]:bg-sky-500/20 data-[state=on]:text-sky-600 dark:data-[state=on]:text-sky-400",
  },
  blue: {
    bg: "bg-blue-500/20",
    bgHover: "hover:bg-blue-500/30",
    text: "text-blue-600 dark:text-blue-400",
    tooltip: "bg-blue-500/90 text-white",
    toggleOn:
      "hover:text-blue-600 dark:hover:text-blue-400 data-[state=on]:bg-blue-500/20 data-[state=on]:text-blue-600 dark:data-[state=on]:text-blue-400",
  },
  indigo: {
    bg: "bg-indigo-500/20",
    bgHover: "hover:bg-indigo-500/30",
    text: "text-indigo-600 dark:text-indigo-400",
    tooltip: "bg-indigo-500/90 text-white",
    toggleOn:
      "hover:text-indigo-600 dark:hover:text-indigo-400 data-[state=on]:bg-indigo-500/20 data-[state=on]:text-indigo-600 dark:data-[state=on]:text-indigo-400",
  },
  violet: {
    bg: "bg-violet-500/20",
    bgHover: "hover:bg-violet-500/30",
    text: "text-violet-600 dark:text-violet-400",
    tooltip: "bg-violet-500/90 text-white",
    toggleOn:
      "hover:text-violet-600 dark:hover:text-violet-400 data-[state=on]:bg-violet-500/20 data-[state=on]:text-violet-600 dark:data-[state=on]:text-violet-400",
  },
  purple: {
    bg: "bg-purple-500/20",
    bgHover: "hover:bg-purple-500/30",
    text: "text-purple-600 dark:text-purple-400",
    tooltip: "bg-purple-500/90 text-white",
    toggleOn:
      "hover:text-purple-600 dark:hover:text-purple-400 data-[state=on]:bg-purple-500/20 data-[state=on]:text-purple-600 dark:data-[state=on]:text-purple-400",
  },
  fuchsia: {
    bg: "bg-fuchsia-500/20",
    bgHover: "hover:bg-fuchsia-500/30",
    text: "text-fuchsia-600 dark:text-fuchsia-400",
    tooltip: "bg-fuchsia-500/90 text-white",
    toggleOn:
      "hover:text-fuchsia-600 dark:hover:text-fuchsia-400 data-[state=on]:bg-fuchsia-500/20 data-[state=on]:text-fuchsia-600 dark:data-[state=on]:text-fuchsia-400",
  },
  pink: {
    bg: "bg-pink-500/20",
    bgHover: "hover:bg-pink-500/30",
    text: "text-pink-600 dark:text-pink-400",
    tooltip: "bg-pink-500/90 text-white",
    toggleOn:
      "hover:text-pink-600 dark:hover:text-pink-400 data-[state=on]:bg-pink-500/20 data-[state=on]:text-pink-600 dark:data-[state=on]:text-pink-400",
  },
  rose: {
    bg: "bg-rose-500/20",
    bgHover: "hover:bg-rose-500/30",
    text: "text-rose-600 dark:text-rose-400",
    tooltip: "bg-rose-500/90 text-white",
    toggleOn:
      "hover:text-rose-600 dark:hover:text-rose-400 data-[state=on]:bg-rose-500/20 data-[state=on]:text-rose-600 dark:data-[state=on]:text-rose-400",
  },
  slate: {
    bg: "bg-slate-500/20",
    bgHover: "hover:bg-slate-500/30",
    text: "text-slate-600 dark:text-slate-400",
    tooltip: "bg-slate-500/90 text-white",
    toggleOn:
      "hover:text-slate-600 dark:hover:text-slate-400 data-[state=on]:bg-slate-500/20 data-[state=on]:text-slate-600 dark:data-[state=on]:text-slate-400",
  },
};

/**
 * Stat-strip / section-card "wash" tones.
 *
 * Each tone maps to the four static Tailwind class groups the unified
 * `StatStrip` primitive and accented `SectionCard` headers need. Enumerated
 * statically so Tailwind's JIT picks up every class. Extends the 18 accents
 * with a `"muted"` tone for neutral/inactive cells.
 */
export type StripTone = AccentColor | "muted";

export interface StripToneClasses {
  /** Cell body: `bg-{accent}-500/5 border-{accent}-500/20` equivalent. */
  cell: string;
  /** `hover:border-{accent}-500/60` equivalent. */
  hoverBorder: string;
  /** `ring-2 ring-{accent}-500/60` equivalent (for `aria-current` cells). */
  ring: string;
  /** Icon well: `bg-{accent}-500/10 text-{accent}-600 dark:text-{accent}-400`. */
  iconWell: string;
  /** Header wash (SectionCard): lighter variant so header stands out gently. */
  headerWash: string;
}

export const stripToneClasses: Record<StripTone, StripToneClasses> = {
  red: {
    cell: "border-red-500/20 bg-red-500/5",
    hoverBorder: "hover:border-red-500/60",
    ring: "ring-2 ring-red-500/60",
    iconWell: "bg-red-500/10 text-red-600 dark:text-red-400",
    headerWash: "bg-red-500/5 border-b-red-500/20",
  },
  orange: {
    cell: "border-orange-500/20 bg-orange-500/5",
    hoverBorder: "hover:border-orange-500/60",
    ring: "ring-2 ring-orange-500/60",
    iconWell: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
    headerWash: "bg-orange-500/5 border-b-orange-500/20",
  },
  amber: {
    cell: "border-amber-500/20 bg-amber-500/5",
    hoverBorder: "hover:border-amber-500/60",
    ring: "ring-2 ring-amber-500/60",
    iconWell: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    headerWash: "bg-amber-500/5 border-b-amber-500/20",
  },
  yellow: {
    cell: "border-yellow-500/20 bg-yellow-500/5",
    hoverBorder: "hover:border-yellow-500/60",
    ring: "ring-2 ring-yellow-500/60",
    iconWell: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
    headerWash: "bg-yellow-500/5 border-b-yellow-500/20",
  },
  lime: {
    cell: "border-lime-500/20 bg-lime-500/5",
    hoverBorder: "hover:border-lime-500/60",
    ring: "ring-2 ring-lime-500/60",
    iconWell: "bg-lime-500/10 text-lime-600 dark:text-lime-400",
    headerWash: "bg-lime-500/5 border-b-lime-500/20",
  },
  green: {
    cell: "border-green-500/20 bg-green-500/5",
    hoverBorder: "hover:border-green-500/60",
    ring: "ring-2 ring-green-500/60",
    iconWell: "bg-green-500/10 text-green-600 dark:text-green-400",
    headerWash: "bg-green-500/5 border-b-green-500/20",
  },
  emerald: {
    cell: "border-emerald-500/20 bg-emerald-500/5",
    hoverBorder: "hover:border-emerald-500/60",
    ring: "ring-2 ring-emerald-500/60",
    iconWell: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    headerWash: "bg-emerald-500/5 border-b-emerald-500/20",
  },
  teal: {
    cell: "border-teal-500/20 bg-teal-500/5",
    hoverBorder: "hover:border-teal-500/60",
    ring: "ring-2 ring-teal-500/60",
    iconWell: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
    headerWash: "bg-teal-500/5 border-b-teal-500/20",
  },
  cyan: {
    cell: "border-cyan-500/20 bg-cyan-500/5",
    hoverBorder: "hover:border-cyan-500/60",
    ring: "ring-2 ring-cyan-500/60",
    iconWell: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
    headerWash: "bg-cyan-500/5 border-b-cyan-500/20",
  },
  sky: {
    cell: "border-sky-500/20 bg-sky-500/5",
    hoverBorder: "hover:border-sky-500/60",
    ring: "ring-2 ring-sky-500/60",
    iconWell: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
    headerWash: "bg-sky-500/5 border-b-sky-500/20",
  },
  blue: {
    cell: "border-blue-500/20 bg-blue-500/5",
    hoverBorder: "hover:border-blue-500/60",
    ring: "ring-2 ring-blue-500/60",
    iconWell: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    headerWash: "bg-blue-500/5 border-b-blue-500/20",
  },
  indigo: {
    cell: "border-indigo-500/20 bg-indigo-500/5",
    hoverBorder: "hover:border-indigo-500/60",
    ring: "ring-2 ring-indigo-500/60",
    iconWell: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
    headerWash: "bg-indigo-500/5 border-b-indigo-500/20",
  },
  violet: {
    cell: "border-violet-500/20 bg-violet-500/5",
    hoverBorder: "hover:border-violet-500/60",
    ring: "ring-2 ring-violet-500/60",
    iconWell: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
    headerWash: "bg-violet-500/5 border-b-violet-500/20",
  },
  purple: {
    cell: "border-purple-500/20 bg-purple-500/5",
    hoverBorder: "hover:border-purple-500/60",
    ring: "ring-2 ring-purple-500/60",
    iconWell: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
    headerWash: "bg-purple-500/5 border-b-purple-500/20",
  },
  fuchsia: {
    cell: "border-fuchsia-500/20 bg-fuchsia-500/5",
    hoverBorder: "hover:border-fuchsia-500/60",
    ring: "ring-2 ring-fuchsia-500/60",
    iconWell: "bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400",
    headerWash: "bg-fuchsia-500/5 border-b-fuchsia-500/20",
  },
  pink: {
    cell: "border-pink-500/20 bg-pink-500/5",
    hoverBorder: "hover:border-pink-500/60",
    ring: "ring-2 ring-pink-500/60",
    iconWell: "bg-pink-500/10 text-pink-600 dark:text-pink-400",
    headerWash: "bg-pink-500/5 border-b-pink-500/20",
  },
  rose: {
    cell: "border-rose-500/20 bg-rose-500/5",
    hoverBorder: "hover:border-rose-500/60",
    ring: "ring-2 ring-rose-500/60",
    iconWell: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
    headerWash: "bg-rose-500/5 border-b-rose-500/20",
  },
  slate: {
    cell: "border-slate-500/20 bg-slate-500/5",
    hoverBorder: "hover:border-slate-500/60",
    ring: "ring-2 ring-slate-500/60",
    iconWell: "bg-slate-500/10 text-slate-600 dark:text-slate-400",
    headerWash: "bg-slate-500/5 border-b-slate-500/20",
  },
  muted: {
    cell: "border-border bg-muted/20",
    hoverBorder: "hover:border-foreground/20",
    ring: "ring-2 ring-foreground/30",
    iconWell: "bg-muted text-muted-foreground",
    headerWash: "bg-muted/30 border-b-border",
  },
};

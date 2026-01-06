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
 * Used for backgrounds, text, and hover states
 */
export const accentTailwindClasses: Record<
  AccentColor,
  { bg: string; bgHover: string; text: string; tooltip: string }
> = {
  red: {
    bg: "bg-red-500/20",
    bgHover: "hover:bg-red-500/30",
    text: "text-red-600 dark:text-red-400",
    tooltip: "bg-red-500/90 text-white",
  },
  orange: {
    bg: "bg-orange-500/20",
    bgHover: "hover:bg-orange-500/30",
    text: "text-orange-600 dark:text-orange-400",
    tooltip: "bg-orange-500/90 text-white",
  },
  amber: {
    bg: "bg-amber-500/20",
    bgHover: "hover:bg-amber-500/30",
    text: "text-amber-600 dark:text-amber-400",
    tooltip: "bg-amber-500/90 text-white",
  },
  yellow: {
    bg: "bg-yellow-500/20",
    bgHover: "hover:bg-yellow-500/30",
    text: "text-yellow-600 dark:text-yellow-400",
    tooltip: "bg-yellow-500/90 text-white",
  },
  lime: {
    bg: "bg-lime-500/20",
    bgHover: "hover:bg-lime-500/30",
    text: "text-lime-600 dark:text-lime-400",
    tooltip: "bg-lime-500/90 text-white",
  },
  green: {
    bg: "bg-green-500/20",
    bgHover: "hover:bg-green-500/30",
    text: "text-green-600 dark:text-green-400",
    tooltip: "bg-green-500/90 text-white",
  },
  emerald: {
    bg: "bg-emerald-500/20",
    bgHover: "hover:bg-emerald-500/30",
    text: "text-emerald-600 dark:text-emerald-400",
    tooltip: "bg-emerald-500/90 text-white",
  },
  teal: {
    bg: "bg-teal-500/20",
    bgHover: "hover:bg-teal-500/30",
    text: "text-teal-600 dark:text-teal-400",
    tooltip: "bg-teal-500/90 text-white",
  },
  cyan: {
    bg: "bg-cyan-500/20",
    bgHover: "hover:bg-cyan-500/30",
    text: "text-cyan-600 dark:text-cyan-400",
    tooltip: "bg-cyan-500/90 text-white",
  },
  sky: {
    bg: "bg-sky-500/20",
    bgHover: "hover:bg-sky-500/30",
    text: "text-sky-600 dark:text-sky-400",
    tooltip: "bg-sky-500/90 text-white",
  },
  blue: {
    bg: "bg-blue-500/20",
    bgHover: "hover:bg-blue-500/30",
    text: "text-blue-600 dark:text-blue-400",
    tooltip: "bg-blue-500/90 text-white",
  },
  indigo: {
    bg: "bg-indigo-500/20",
    bgHover: "hover:bg-indigo-500/30",
    text: "text-indigo-600 dark:text-indigo-400",
    tooltip: "bg-indigo-500/90 text-white",
  },
  violet: {
    bg: "bg-violet-500/20",
    bgHover: "hover:bg-violet-500/30",
    text: "text-violet-600 dark:text-violet-400",
    tooltip: "bg-violet-500/90 text-white",
  },
  purple: {
    bg: "bg-purple-500/20",
    bgHover: "hover:bg-purple-500/30",
    text: "text-purple-600 dark:text-purple-400",
    tooltip: "bg-purple-500/90 text-white",
  },
  fuchsia: {
    bg: "bg-fuchsia-500/20",
    bgHover: "hover:bg-fuchsia-500/30",
    text: "text-fuchsia-600 dark:text-fuchsia-400",
    tooltip: "bg-fuchsia-500/90 text-white",
  },
  pink: {
    bg: "bg-pink-500/20",
    bgHover: "hover:bg-pink-500/30",
    text: "text-pink-600 dark:text-pink-400",
    tooltip: "bg-pink-500/90 text-white",
  },
  rose: {
    bg: "bg-rose-500/20",
    bgHover: "hover:bg-rose-500/30",
    text: "text-rose-600 dark:text-rose-400",
    tooltip: "bg-rose-500/90 text-white",
  },
  slate: {
    bg: "bg-slate-500/20",
    bgHover: "hover:bg-slate-500/30",
    text: "text-slate-600 dark:text-slate-400",
    tooltip: "bg-slate-500/90 text-white",
  },
};

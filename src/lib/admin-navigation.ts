/**
 * Polaris Track A: ADMIN-surface navigation (renamed from `navigation.ts`).
 *
 * Consumed by:
 *   - `components/AppSidebar.tsx` — desktop + mobile nav rendering for the
 *     admin surface (manage.polaris.express).
 *   - `src/lib/command-palette/commands.ts` — Navigate group in ⌘K palette.
 *
 * The customer surface (polaris.express) loads its nav from
 * `customer-navigation.ts`. Both files export the same `NavSection` /
 * `NavItem` shape so the layout components can take them
 * interchangeably via a `navSections` prop.
 *
 * Backwards compat: `NAV_SECTIONS` is kept as an alias for the new
 * canonical `ADMIN_NAV_SECTIONS` so no import sites break during the
 * surface-rename rollout.
 *
 * Rules:
 *   - This file is intentionally preact/compat-free. It only exports plain
 *     data + icon components from `lucide-preact`, so it can be imported from
 *     both islands (.tsx) and plain .ts modules without forcing a compat
 *     dependency into the latter.
 *   - `id` is a stable path-based identifier ("nav:<path>"). Stored in the
 *     palette's Recent LRU, so renaming a title never invalidates recents.
 */

import {
  BatteryCharging,
  Bell,
  CalendarClock,
  FileText,
  Link2,
  type LucideIcon,
  Receipt,
  RefreshCw,
  Smartphone,
  Tag,
  Users,
  Webhook,
} from "lucide-preact";
import type { AccentColor } from "./colors.ts";

/** Extended accent set used by nav chrome — includes "primary" for the root. */
export type NavAccent = AccentColor | "primary";

export interface NavItem {
  /** Stable path-based id, e.g. "nav:/chargers". */
  id: string;
  title: string;
  path: string;
  icon: LucideIcon;
  accentColor: NavAccent;
  keywords?: string[];
  adminOnly?: boolean;
}

export interface NavSection {
  id: string;
  title: string;
  items: NavItem[];
  adminOnly?: boolean;
}

export const ADMIN_NAV_SECTIONS: NavSection[] = [
  {
    id: "operations",
    title: "Operations",
    items: [
      {
        id: "nav:/chargers",
        title: "Chargers",
        path: "/chargers",
        icon: BatteryCharging,
        accentColor: "orange",
        keywords: ["charge box", "ocpp"],
      },
      {
        // ExpresScan Wave 4 (D2): admin Devices surface — phones-only listing
        // for v1; chargers stay on /admin/chargers. Position is between
        // Chargers and Reservations (per docs/plan/40-frontend.md
        // § Sidebar nav addition).
        id: "nav:/admin/devices",
        title: "Devices",
        path: "/admin/devices",
        icon: Smartphone,
        accentColor: "teal",
        keywords: ["phone", "tap", "nfc", "laptop"],
        adminOnly: true,
      },
      {
        id: "nav:/reservations",
        title: "Reservations",
        path: "/reservations",
        icon: CalendarClock,
        accentColor: "indigo",
        keywords: ["booking"],
      },
      {
        id: "nav:/sync",
        title: "Sync",
        path: "/sync",
        icon: RefreshCw,
        accentColor: "blue",
        keywords: ["sync run", "history"],
      },
    ],
  },
  {
    id: "billing",
    title: "Billing",
    items: [
      {
        id: "nav:/transactions",
        title: "Charging Sessions",
        path: "/transactions",
        icon: Receipt,
        accentColor: "green",
        keywords: ["transactions", "sessions", "kwh"],
      },
      {
        id: "nav:/invoices",
        title: "Invoices",
        path: "/invoices",
        icon: FileText,
        accentColor: "teal",
        keywords: ["lago", "bill"],
      },
    ],
  },
  {
    id: "identity",
    title: "Identity",
    items: [
      {
        id: "nav:/tags",
        title: "Tags",
        path: "/tags",
        icon: Tag,
        accentColor: "cyan",
        keywords: ["ocpp tag"],
      },
      {
        id: "nav:/links",
        title: "Tag Linking",
        path: "/links",
        icon: Link2,
        accentColor: "violet",
        keywords: ["mapping"],
      },
      {
        id: "nav:/users",
        title: "Users",
        path: "/users",
        icon: Users,
        accentColor: "amber",
        keywords: ["admin"],
      },
    ],
  },
  {
    id: "admin",
    title: "Admin",
    adminOnly: true,
    items: [
      {
        id: "nav:/notifications",
        title: "Notifications",
        path: "/notifications",
        icon: Bell,
        accentColor: "sky",
        adminOnly: true,
      },
      {
        id: "nav:/admin/webhook-events",
        title: "Webhook Events",
        path: "/admin/webhook-events",
        icon: Webhook,
        accentColor: "rose",
        keywords: ["lago webhook", "audit"],
        adminOnly: true,
      },
    ],
  },
];

/** Flatten ADMIN_NAV_SECTIONS; filter admin-only sections & items for non-admins. */
export function getAllNavItems(isAdmin = false): NavItem[] {
  const out: NavItem[] = [];
  for (const section of ADMIN_NAV_SECTIONS) {
    if (section.adminOnly && !isAdmin) continue;
    for (const item of section.items) {
      if (item.adminOnly && !isAdmin) continue;
      out.push(item);
    }
  }
  return out;
}

/**
 * Locate the section + item matching a concrete route path.
 * Root path ("/") matches exactly; all others match by prefix.
 */
export function findSectionByPath(
  path: string,
): { section: NavSection; item: NavItem } | null {
  // Prefer exact match first so "/" doesn't swallow longer paths.
  for (const section of ADMIN_NAV_SECTIONS) {
    for (const item of section.items) {
      if (item.path === path) return { section, item };
    }
  }
  // Prefix match for nested routes (skip root to avoid swallowing).
  let best: { section: NavSection; item: NavItem; len: number } | null = null;
  for (const section of ADMIN_NAV_SECTIONS) {
    for (const item of section.items) {
      if (item.path === "/") continue;
      if (path.startsWith(item.path + "/") || path === item.path) {
        if (!best || item.path.length > best.len) {
          best = { section, item, len: item.path.length };
        }
      }
    }
  }
  return best ? { section: best.section, item: best.item } : null;
}

/** Active-state test used by the sidebar and the palette. */
export function isPathActive(itemPath: string, currentPath: string): boolean {
  if (itemPath === "/") return currentPath === "/";
  return currentPath === itemPath || currentPath.startsWith(itemPath + "/");
}

/**
 * Backwards-compatibility alias. `NAV_SECTIONS` was the original export
 * before the surface split (Polaris Track A). New code should import
 * `ADMIN_NAV_SECTIONS` directly; this alias exists to avoid breaking
 * existing imports during the rollout.
 *
 * @deprecated Use `ADMIN_NAV_SECTIONS` instead.
 */
export const NAV_SECTIONS: NavSection[] = ADMIN_NAV_SECTIONS;

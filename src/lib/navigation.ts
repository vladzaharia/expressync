/**
 * Single source of truth for the primary navigation.
 *
 * Consumed by:
 *   - `components/AppSidebar.tsx` — desktop + mobile nav rendering.
 *   - `src/lib/command-palette/commands.ts` — Navigate group in ⌘K palette.
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
  LayoutDashboard,
  Link2,
  type LucideIcon,
  Receipt,
  RefreshCw,
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

export const NAV_SECTIONS: NavSection[] = [
  {
    id: "dashboard",
    title: "Dashboard",
    items: [
      {
        id: "nav:/",
        title: "Dashboard",
        path: "/",
        icon: LayoutDashboard,
        accentColor: "primary",
        keywords: ["home", "overview"],
      },
    ],
  },
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

/** Flatten NAV_SECTIONS; filter admin-only sections & items for non-admins. */
export function getAllNavItems(isAdmin = false): NavItem[] {
  const out: NavItem[] = [];
  for (const section of NAV_SECTIONS) {
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
  for (const section of NAV_SECTIONS) {
    for (const item of section.items) {
      if (item.path === path) return { section, item };
    }
  }
  // Prefix match for nested routes (skip root to avoid swallowing).
  let best: { section: NavSection; item: NavItem; len: number } | null = null;
  for (const section of NAV_SECTIONS) {
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

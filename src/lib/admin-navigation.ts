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
    id: "devices",
    title: "Devices",
    items: [
      {
        // Unified Devices surface (April 2026): chargers + scanners share
        // one listing. The legacy `/admin/chargers` route 302-redirects to
        // `/admin/devices?type=charger` so old links keep working.
        id: "nav:/admin/devices",
        title: "Devices",
        path: "/admin/devices",
        icon: Smartphone,
        accentColor: "teal",
        keywords: [
          "charger",
          "charge box",
          "ocpp",
          "phone",
          "scanner",
          "tap",
          "nfc",
          "laptop",
        ],
        adminOnly: true,
      },
    ],
  },
  {
    id: "sessions",
    title: "Sessions",
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
        id: "nav:/reservations",
        title: "Reservations",
        path: "/reservations",
        icon: CalendarClock,
        accentColor: "indigo",
        keywords: ["booking"],
      },
    ],
  },
  {
    id: "billing",
    title: "Billing & Customers",
    items: [
      {
        id: "nav:/invoices",
        title: "Invoices",
        path: "/invoices",
        icon: FileText,
        accentColor: "teal",
        keywords: ["lago", "bill"],
      },
      {
        id: "nav:/users",
        title: "Users",
        path: "/users",
        icon: Users,
        accentColor: "amber",
        keywords: ["admin"],
      },
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
    ],
  },
  {
    id: "system",
    title: "System",
    adminOnly: true,
    items: [
      {
        id: "nav:/sync",
        title: "Sync",
        path: "/sync",
        icon: RefreshCw,
        accentColor: "blue",
        keywords: ["sync run", "history"],
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
  // Match against both the raw path and the `/admin`-stripped form — see
  // `isPathActive` for why the rewrite makes both shapes valid inputs.
  const stripped = path.startsWith("/admin/") || path === "/admin"
    ? path.slice("/admin".length) || "/"
    : path;
  const candidates = stripped === path ? [path] : [path, stripped];

  // Prefer exact match first so "/" doesn't swallow longer paths.
  for (const section of ADMIN_NAV_SECTIONS) {
    for (const item of section.items) {
      if (candidates.includes(item.path)) return { section, item };
    }
  }
  // Prefix match for nested routes (skip root to avoid swallowing).
  let best: { section: NavSection; item: NavItem; len: number } | null = null;
  for (const section of ADMIN_NAV_SECTIONS) {
    for (const item of section.items) {
      if (item.path === "/") continue;
      const hit = candidates.some((c) =>
        c === item.path || c.startsWith(item.path + "/")
      );
      if (hit && (!best || item.path.length > best.len)) {
        best = { section, item, len: item.path.length };
      }
    }
  }
  return best ? { section: best.section, item: best.item } : null;
}

/** Active-state test used by the sidebar and the palette.
 *
 * The admin host rewrites browser-clean URLs (`/sync`) to `/admin/sync`
 * server-side (see `main.ts#polarisCreateFetchHandler`), so route handlers
 * pass the rewritten `url.pathname` as `currentPath`. Match against both
 * the rewritten and stripped form so nav items that target a clean path
 * (`/sync`) and items that target the prefixed path (`/admin/devices`)
 * both highlight correctly.
 */
export function isPathActive(itemPath: string, currentPath: string): boolean {
  const stripped =
    currentPath.startsWith("/admin/") || currentPath === "/admin"
      ? currentPath.slice("/admin".length) || "/"
      : currentPath;
  const matches = (path: string) =>
    itemPath === "/"
      ? path === "/"
      : path === itemPath || path.startsWith(itemPath + "/");
  return matches(currentPath) || matches(stripped);
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

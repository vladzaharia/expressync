/**
 * Polaris Track A — customer-surface navigation.
 *
 * Mirrors the shape of `admin-navigation.ts` (formerly `navigation.ts`) so
 * `AppSidebar.tsx` and `SidebarLayout.tsx` can swap nav modules based on
 * `ctx.state.surface`. Same `NavSection` / `NavItem` shape; same accent
 * convention; same `getAllNavItems()` / `findSectionByPath()` /
 * `isPathActive()` helpers exported.
 *
 * Customer surface IS NOT admin-feature-rich — it's a 5-tab portal:
 *   - Dashboard       (Zap)
 *   - Sessions        (Receipt)
 *   - Reservations    (CalendarClock)
 *   - Cards           (CreditCard)
 *   - Billing         (Wallet)
 *
 * Account / settings live in a top-right `UserAvatarMenu` (per the plan),
 * NOT in the bottom-tab nav.
 */

import {
  CalendarClock,
  CreditCard,
  type LucideIcon,
  Receipt,
  Wallet,
  Zap,
} from "lucide-preact";
import type { AccentColor } from "./colors.ts";

/** Extended accent set used by nav chrome — includes "primary" for the root. */
export type NavAccent = AccentColor | "primary";

export interface NavItem {
  /** Stable path-based id, e.g. "nav:/sessions". */
  id: string;
  title: string;
  path: string;
  icon: LucideIcon;
  accentColor: NavAccent;
  keywords?: string[];
  /** Always false on customer surface — kept for shape parity with admin nav. */
  adminOnly?: boolean;
}

export interface NavSection {
  id: string;
  title: string;
  items: NavItem[];
  adminOnly?: boolean;
}

/**
 * Customer navigation — accent colors mirror the per-page accent table
 * from the plan (Sessions=green, Reservations=indigo, Cards=cyan,
 * Billing=teal). Dashboard uses `primary` because it's the brand-forward
 * landing surface.
 */
export const CUSTOMER_NAV_SECTIONS: NavSection[] = [
  {
    id: "main",
    title: "",
    items: [
      {
        id: "nav:/",
        title: "Dashboard",
        path: "/",
        icon: Zap,
        accentColor: "primary",
        keywords: ["home", "overview", "charge"],
      },
      {
        id: "nav:/sessions",
        title: "Sessions",
        path: "/sessions",
        icon: Receipt,
        accentColor: "green",
        keywords: ["history", "kwh", "transactions"],
      },
      {
        id: "nav:/reservations",
        title: "Reservations",
        path: "/reservations",
        icon: CalendarClock,
        accentColor: "indigo",
        keywords: ["booking", "reserve", "schedule"],
      },
      {
        id: "nav:/cards",
        title: "Cards",
        path: "/cards",
        icon: CreditCard,
        accentColor: "cyan",
        keywords: ["tag", "rfid"],
      },
      {
        id: "nav:/billing",
        title: "Billing",
        path: "/billing",
        icon: Wallet,
        accentColor: "teal",
        keywords: ["invoice", "subscription", "usage"],
      },
    ],
  },
];

/** Flatten nav sections (parity with admin-navigation). */
export function getAllNavItems(): NavItem[] {
  const out: NavItem[] = [];
  for (const section of CUSTOMER_NAV_SECTIONS) {
    for (const item of section.items) out.push(item);
  }
  return out;
}

/** Locate the section + item matching a concrete route path. */
export function findSectionByPath(
  path: string,
): { section: NavSection; item: NavItem } | null {
  for (const section of CUSTOMER_NAV_SECTIONS) {
    for (const item of section.items) {
      if (item.path === path) return { section, item };
    }
  }
  let best: { section: NavSection; item: NavItem; len: number } | null = null;
  for (const section of CUSTOMER_NAV_SECTIONS) {
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

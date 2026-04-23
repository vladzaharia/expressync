/**
 * Customer-surface command catalogue for the ⌘K palette (Polaris Track H).
 *
 * Mirrors the admin-side `commands.ts` shape so `islands/CommandPalette.tsx`
 * can branch on `ctx.state.surface` (or `state.user.role === 'customer'`)
 * and pick the right registry. Two kinds of commands:
 *
 *   - `navigate` → pure `href` hops; palette closes after execution.
 *   - `action`   → runs a callback (POST, navigate, toast, etc.) and may
 *                  optionally keep the palette open (⌘Enter) for chained
 *                  use.
 *
 * Customer-safe surface area only. No admin-mode actions (sync trigger,
 * reset cadence, webhook audit) — those would 403 from the customer
 * routes anyway, but keeping the registry small avoids surfacing dead
 * options to end users.
 *
 * Dynamic entity rows (this customer's sessions, reservations, invoices,
 * cards) come from `/api/customer/command-palette/search` keyed by the
 * user's query — same shape as the admin search endpoint, scoped to the
 * authenticated user via `resolveCustomerScope`.
 */

import { CalendarPlus, Plus, Receipt, Square, Zap } from "lucide-preact";
import { type CommandAccent, type PaletteCommand } from "./commands.ts";
import { getAllNavItems, type NavItem } from "../customer-navigation.ts";

/**
 * Customer environment passed into action commands. Mirrors the admin
 * `ActionEnv` so the palette plumbing stays identical — only the
 * registries differ.
 */
export interface CustomerActionEnv {
  /** `sonner` toast injected by the palette (keeps this file import-light). */
  toast: {
    promise: <T>(
      promise: Promise<T>,
      opts: { loading: string; success: string; error: string },
    ) => unknown;
    success: (msg: string) => unknown;
    error: (msg: string) => unknown;
  };
  /** Navigates without a full reload (palette uses location.href today). */
  navigate: (href: string) => void;
  /**
   * Optional dispatcher to open the customer scan modal. If undefined,
   * the "Start charging" action falls back to navigating to the
   * dashboard where the scan modal lives.
   */
  openScanModal?: () => void;
}

/**
 * Build the customer navigation commands. Sources from
 * `customer-navigation.ts` so the palette and the sidebar always agree.
 */
export function buildCustomerNavigateCommands(): PaletteCommand[] {
  return getAllNavItems().map((it: NavItem) => ({
    id: it.id,
    kind: "navigate",
    group: "navigate",
    title: it.title,
    subtitle: it.path,
    icon: it.icon,
    accent: it.accentColor as CommandAccent,
    href: it.path,
    keywords: it.keywords,
  }));
}

/**
 * Build the customer action commands. Three top-level intents:
 *   1. Start charging — open the scan modal (or land on the dashboard).
 *   2. Stop charging  — symmetric counterpart; visible regardless of
 *      session state for MVP simplicity (the dashboard handles the
 *      no-active-session case).
 *   3. New reservation — direct hop to the reservation wizard.
 */
export function buildCustomerActionCommands(
  env: CustomerActionEnv,
): PaletteCommand[] {
  return [
    {
      id: "action:start-charging",
      kind: "action",
      group: "actions",
      title: "Start charging",
      subtitle: "Scan a charger to begin a session",
      icon: Zap,
      accent: "primary",
      keywords: ["scan", "begin", "tap", "charge"],
      run: () => {
        if (env.openScanModal) {
          env.openScanModal();
        } else {
          // Fallback: dashboard hosts the scan trigger (HeroSessionCard /
          // ReadyToChargeCard). Drops the user one click away from scan.
          env.navigate("/");
        }
      },
    },
    {
      id: "action:stop-charging",
      kind: "action",
      group: "actions",
      title: "Stop charging",
      subtitle: "End your active session",
      icon: Square,
      // Destructive-leaning; using `red` accent makes the icon stand out
      // against the "start" green/primary above.
      accent: "red",
      keywords: ["end", "halt", "stop", "session"],
      run: () => {
        // The dashboard shows the live HeroSessionCard with a Stop button
        // wired to the proper confirm flow. The palette deliberately does
        // NOT POST `/api/customer/session-stop` directly so the user
        // always sees the confirmation + 5s undo toast.
        env.navigate("/");
      },
    },
    {
      id: "action:new-reservation",
      kind: "action",
      group: "actions",
      title: "New reservation",
      subtitle: "Reserve a charging window",
      icon: CalendarPlus,
      accent: "indigo",
      keywords: ["book", "reserve", "schedule", "new"],
      run: () => env.navigate("/reservations/new"),
    },
    {
      id: "action:my-sessions",
      kind: "action",
      group: "actions",
      title: "My sessions",
      subtitle: "View charging history",
      icon: Receipt,
      accent: "green",
      keywords: ["history", "sessions", "kwh"],
      run: () => env.navigate("/sessions"),
    },
    {
      id: "action:my-reservations",
      kind: "action",
      group: "actions",
      title: "My reservations",
      subtitle: "Upcoming and past bookings",
      icon: Plus,
      accent: "indigo",
      keywords: ["reservations", "bookings"],
      run: () => env.navigate("/reservations"),
    },
    {
      id: "action:my-invoices",
      kind: "action",
      group: "actions",
      title: "My invoices",
      subtitle: "Billing history",
      icon: Receipt,
      accent: "teal",
      keywords: ["billing", "invoices", "spend"],
      run: () => env.navigate("/billing"),
    },
  ];
}

/**
 * Pre-built navigation commands for the customer surface. Exposed for
 * callers that don't need the action commands (e.g. a static menu list).
 */
export const CUSTOMER_NAVIGATE_COMMANDS: PaletteCommand[] =
  buildCustomerNavigateCommands();

/**
 * Convenience accessor — returns the full customer command set
 * (navigate + actions). Equivalent to spreading the two builder outputs.
 */
export function buildCustomerCommands(
  env: CustomerActionEnv,
): PaletteCommand[] {
  return [
    ...buildCustomerNavigateCommands(),
    ...buildCustomerActionCommands(env),
  ];
}

/**
 * Static export for tooling/tests that just want the navigate commands.
 * The full `CUSTOMER_COMMANDS` list (including actions) requires an
 * action-env to dispatch into and so is constructed at the call site
 * via `buildCustomerCommands(env)`.
 */
export const CUSTOMER_COMMANDS = CUSTOMER_NAVIGATE_COMMANDS;

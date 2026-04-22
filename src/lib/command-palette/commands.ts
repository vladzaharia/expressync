/**
 * Static command catalogue for the ⌘K palette (Phase P6).
 *
 * Two kinds of commands are produced here:
 *   - `navigate` → pure `href` hops; palette closes after execution.
 *   - `action`   → runs a callback (POST, toast, etc.) and may optionally
 *                  keep the palette open (⌘Enter) for chained use.
 *
 * Dynamic entity rows (chargers, tags, customers, invoices, reservations,
 * sync runs) are NOT produced here — they come from
 * `/api/command-palette/search` keyed by the user's query.
 */

import { LayoutDashboard, Plus, RefreshCw, Shield, Zap } from "lucide-preact";
import type { AccentColor } from "@/src/lib/colors.ts";
import { getAllNavItems, type NavItem } from "@/src/lib/navigation.ts";

export type CommandKind = "navigate" | "action";
export type CommandAccent = AccentColor | "primary" | "neutral";

export interface PaletteCommand {
  id: string;
  kind: CommandKind;
  group: "navigate" | "actions";
  title: string;
  subtitle?: string;
  /** Lucide icon component; palette renders at 16px sized. */
  icon: typeof LayoutDashboard;
  accent: CommandAccent;
  /** For `navigate` commands. */
  href?: string;
  /**
   * Keywords used by cmdk's fuzzy matcher. Cheap way to make commands like
   * "trigger sync" findable by "refresh", "pull", etc.
   */
  keywords?: string[];
  /**
   * For `action` commands. Receives a `keepOpen` flag reflecting whether
   * the user pressed ⌘Enter (chained execution).
   */
  run?: (keepOpen: boolean) => Promise<void> | void;
  /** If true, after `run()` the palette stays open regardless of modifier. */
  keepOpenAfterRun?: boolean;
}

/**
 * Navigate commands are built from the shared nav source of truth in
 * `src/lib/navigation.ts`. That module is preact/compat-free so this plain
 * `.ts` file can consume it without pulling the sidebar in transitively.
 */

function postJson(url: string, body?: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export interface ActionEnv {
  /** `sonner` toast function injected by the caller (keeps this file import-light). */
  toast: {
    promise: <T>(
      promise: Promise<T>,
      opts: { loading: string; success: string; error: string },
    ) => unknown;
    success: (msg: string) => unknown;
    error: (msg: string) => unknown;
  };
  /** Navigates without a full reload. */
  navigate: (href: string) => void;
}

export function buildNavigateCommands(isAdmin = false): PaletteCommand[] {
  return getAllNavItems(isAdmin).map((it: NavItem) => ({
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

export function buildActionCommands(env: ActionEnv): PaletteCommand[] {
  return [
    {
      id: "action:sync-now",
      kind: "action",
      group: "actions",
      title: "Trigger sync now",
      subtitle: "POST /api/sync/trigger",
      icon: RefreshCw,
      accent: "blue",
      keywords: ["refresh", "pull", "reconcile"],
      run: () => {
        const p = postJson("/api/sync/trigger").then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        });
        env.toast.promise(p, {
          loading: "Triggering sync run...",
          success: "Sync run started",
          error: "Failed to trigger sync",
        });
      },
    },
    {
      id: "action:reset-cadence",
      kind: "action",
      group: "actions",
      title: "Reset sync cadence",
      subtitle: "Unpin adaptive cadence",
      icon: Zap,
      accent: "blue",
      keywords: ["unpin", "adaptive", "schedule"],
      run: () => {
        const p = fetch("/api/sync/pin", {
          method: "DELETE",
          credentials: "same-origin",
        }).then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        });
        env.toast.promise(p, {
          loading: "Resetting cadence...",
          success: "Cadence reset",
          error: "Failed to reset cadence",
        });
      },
    },
    {
      id: "action:create-reservation",
      kind: "action",
      group: "actions",
      title: "Create reservation",
      subtitle: "New charging window",
      icon: Plus,
      accent: "indigo",
      keywords: ["book", "reserve", "schedule"],
      run: () => env.navigate("/reservations/new"),
    },
    {
      id: "action:create-link",
      kind: "action",
      group: "actions",
      title: "Create tag link",
      subtitle: "Map an OCPP tag to a subscription",
      icon: Plus,
      accent: "violet",
      keywords: ["mapping", "user", "add"],
      run: () => env.navigate("/links/new"),
    },
    {
      id: "action:notifications",
      kind: "action",
      group: "actions",
      title: "View notifications",
      subtitle: "Archive of system alerts",
      icon: Shield,
      accent: "primary",
      keywords: ["alerts", "history", "archive"],
      run: () => env.navigate("/notifications"),
    },
    {
      id: "action:webhook-audit",
      kind: "action",
      group: "actions",
      title: "View webhook audit",
      subtitle: "Lago webhook events + replay",
      icon: Shield,
      accent: "primary",
      keywords: ["lago", "events", "replay", "admin"],
      run: () => env.navigate("/admin/webhook-events"),
    },
  ];
}

/**
 * Accent → Tailwind text class mapping (icon tint only — chrome stays neutral).
 */
export const ACCENT_TEXT: Record<CommandAccent, string> = {
  primary: "text-primary",
  neutral: "text-muted-foreground",
  cyan: "text-cyan-400",
  violet: "text-violet-400",
  orange: "text-orange-400",
  green: "text-green-400",
  blue: "text-blue-400",
  amber: "text-amber-400",
  teal: "text-teal-400",
  indigo: "text-indigo-400",
  sky: "text-sky-400",
  slate: "text-slate-400",
  emerald: "text-emerald-400",
  red: "text-red-400",
  rose: "text-rose-400",
  lime: "text-lime-400",
  pink: "text-pink-400",
  yellow: "text-yellow-400",
  purple: "text-purple-400",
  fuchsia: "text-fuchsia-400",
};

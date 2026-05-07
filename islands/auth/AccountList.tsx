/**
 * AccountList — multi-session account picker / switcher.
 *
 * Self-contained: it figures out which surface it's running on (admin vs
 * customer) from the current hostname and computes the cross-host target
 * by swapping the `manage.` subdomain. The active session id is read from
 * `authClient.getSession()` on mount. This lets the island be embedded
 * without any prop drilling — drop it anywhere a switcher should appear.
 *
 * Visual model — border-only, NEVER background-fill:
 *   - The currently-active session renders as a non-interactive row
 *     with a green outline. It's the visual anchor that doubles as
 *     the "you are X" header in the user menu.
 *   - Other sessions render as buttons with a transparent border by
 *     default and a blue border on hover. No row ever fills its
 *     background.
 *   - Active row is sorted to the top so the eye lands on "you are
 *     here" first, then sees alternates below.
 *   - Per-row revoke (when `allowRevoke`) calls
 *     `authClient.multiSession.revoke` and reloads if the active was
 *     revoked.
 */

import { useEffect, useState } from "preact/hooks";
import {
  Check,
  Loader2,
  LogOut,
  ShieldCheck,
  User as UserIcon,
} from "lucide-preact";
import { authClient } from "@/src/lib/auth-client.ts";
import { cn } from "@/src/lib/utils/cn.ts";

export interface DeviceSessionRow {
  session: {
    id: string;
    token: string;
    userId: string;
  };
  user: {
    id: string;
    email: string;
    name?: string | null;
    image?: string | null;
    role?: string | null;
  };
}

interface AccountListProps {
  /** SSR-fetched sessions. The island re-fetches on mount regardless. */
  initial?: DeviceSessionRow[];
  /**
   * Show the per-row revoke icon. Defaults to true. The login page +
   * portal handoff variants pass false to keep the interaction model
   * focused on switching, not housekeeping.
   */
  allowRevoke?: boolean;
  /** Optional className for the outer container. */
  className?: string;
}

/**
 * Customer host vs admin host derivation.
 *   prod:  manage.example.com ↔ example.com
 *   dev:   manage.polaris.localhost ↔ polaris.localhost
 *   local: manage.{rest}            ↔ {rest}
 *
 * The "is this admin?" rule mirrors `src/lib/hostname-dispatch.ts` —
 * any host that starts with `manage.` (or is `localhost`/`127.0.0.1` in
 * dev) is the admin surface.
 */
function deriveHostContext(hostname: string, port: string): {
  surface: "admin" | "customer";
  customerOrigin: string;
  adminOrigin: string;
} {
  const isLoopback = hostname === "localhost" || hostname === "127.0.0.1";
  const protocol = globalThis.location?.protocol ?? "https:";
  const portSuffix = port ? `:${port}` : "";

  if (isLoopback) {
    // Pure-loopback dev: same origin serves both surfaces. Treat as admin
    // since that's the historical default in this codebase.
    const same = `${protocol}//${hostname}${portSuffix}`;
    return { surface: "admin", customerOrigin: same, adminOrigin: same };
  }

  const isAdmin = hostname.startsWith("manage.");
  const customerHost = isAdmin ? hostname.slice("manage.".length) : hostname;
  const adminHost = isAdmin ? hostname : `manage.${hostname}`;

  return {
    surface: isAdmin ? "admin" : "customer",
    customerOrigin: `${protocol}//${customerHost}${portSuffix}`,
    adminOrigin: `${protocol}//${adminHost}${portSuffix}`,
  };
}

function roleSurface(role?: string | null): "admin" | "customer" {
  return role === "admin" ? "admin" : "customer";
}

export default function AccountList(props: AccountListProps) {
  const { initial, allowRevoke = true, className } = props;

  const [sessions, setSessions] = useState<DeviceSessionRow[]>(initial ?? []);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(initial == null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [listRes, sessionRes] = await Promise.all([
          authClient.multiSession.listDeviceSessions(),
          authClient.getSession(),
        ]);
        if (cancelled) return;
        const data = (listRes.data ?? []) as unknown as DeviceSessionRow[];
        setSessions(data);
        const activeId = (sessionRes.data?.session as { id?: string } | null)
          ?.id ?? null;
        setActiveSessionId(activeId);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSwitch = async (row: DeviceSessionRow) => {
    if (busyId) return;
    setBusyId(row.session.id);
    setError(null);
    try {
      const res = await authClient.multiSession.setActive({
        sessionToken: row.session.token,
      });
      if (res.error) {
        throw new Error(res.error.message ?? "Switch failed");
      }
      const ctx = deriveHostContext(
        globalThis.location.hostname,
        globalThis.location.port,
      );
      const targetSurface = roleSurface(row.user.role);
      if (targetSurface === ctx.surface) {
        globalThis.location.reload();
      } else {
        const target = targetSurface === "admin"
          ? ctx.adminOrigin
          : ctx.customerOrigin;
        globalThis.location.assign(`${target}/`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Switch failed");
      setBusyId(null);
    }
  };

  const handleRevoke = async (row: DeviceSessionRow, ev: Event) => {
    ev.stopPropagation();
    if (busyId) return;
    setBusyId(row.session.id);
    setError(null);
    try {
      const res = await authClient.multiSession.revoke({
        sessionToken: row.session.token,
      });
      if (res.error) {
        throw new Error(res.error.message ?? "Revoke failed");
      }
      if (row.session.id === activeSessionId) {
        globalThis.location.reload();
        return;
      }
      setSessions((prev) =>
        prev.filter((r) => r.session.id !== row.session.id)
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Revoke failed");
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div class="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
        <Loader2 class="size-3.5 animate-spin" aria-hidden="true" />
        <span>Loading accounts…</span>
      </div>
    );
  }

  if (sessions.length === 0) {
    return null;
  }

  // Render the active session first so it doubles as the "you are
  // here" header. Other sessions trail in the order Better Auth
  // returned them (most-recently-active-first per the plugin docs).
  const sortedSessions = activeSessionId
    ? [
      ...sessions.filter((r) => r.session.id === activeSessionId),
      ...sessions.filter((r) => r.session.id !== activeSessionId),
    ]
    : sessions;

  return (
    <div
      class={cn("flex min-w-[16rem] flex-col gap-1", className)}
      role="list"
      aria-label="Signed-in accounts"
    >
      {error && (
        <div
          class="px-2 py-1 text-xs text-rose-600 dark:text-rose-400"
          role="alert"
        >
          {error}
        </div>
      )}
      {sortedSessions.map((row) => {
        const isActive = row.session.id === activeSessionId;
        const isBusy = busyId === row.session.id;
        const surface = roleSurface(row.user.role);
        const Icon = surface === "admin" ? ShieldCheck : UserIcon;
        const label = row.user.name || row.user.email;

        // Shared row content — used by both the non-interactive active
        // row (rendered as a div) and the interactive switchable rows
        // (rendered as buttons). Pulling it out keeps the markup and
        // class logic in one place.
        const rowInner = (
          <>
            <span
              class={cn(
                "inline-flex size-7 shrink-0 items-center justify-center rounded-full border",
                surface === "admin"
                  ? "border-emerald-500/50 text-emerald-600 dark:text-emerald-400"
                  : "border-primary/50 text-primary",
              )}
              aria-hidden="true"
            >
              <Icon class="size-4" />
            </span>
            <span class="flex flex-1 flex-col min-w-0">
              <span class="text-sm font-medium truncate">{label}</span>
              <span class="text-xs text-muted-foreground truncate">
                {row.user.email}
              </span>
            </span>
            {isActive && (
              <Check
                class="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
                aria-label="Current account"
              />
            )}
            {allowRevoke && !isActive && (
              <span
                role="button"
                tabIndex={0}
                aria-label={`Sign out of ${label}`}
                title="Sign out of this account"
                onClick={(ev: Event) => handleRevoke(row, ev)}
                onKeyDown={(ev: KeyboardEvent) => {
                  if (ev.key === "Enter" || ev.key === " ") {
                    handleRevoke(row, ev);
                  }
                }}
                class={cn(
                  "ml-1 inline-flex size-6 shrink-0 items-center justify-center rounded border border-transparent",
                  "text-muted-foreground transition-colors",
                  "hover:border-destructive/50 hover:text-destructive",
                )}
              >
                {isBusy
                  ? <Loader2 class="size-3.5 animate-spin" />
                  : <LogOut class="size-3.5" />}
              </span>
            )}
            {isBusy && !allowRevoke && (
              <Loader2 class="size-3.5 animate-spin text-muted-foreground" />
            )}
          </>
        );

        // Active row: green border, non-interactive (no click handler,
        // no button semantics, default cursor).
        if (isActive) {
          return (
            <div
              key={row.session.id}
              role="listitem"
              aria-current="true"
              class="flex items-center gap-2 rounded-md border border-emerald-500/50 px-2 py-1.5 text-left"
            >
              {rowInner}
            </div>
          );
        }

        // Switchable row: transparent border by default, blue border on
        // hover. NEVER applies a background fill.
        return (
          <button
            key={row.session.id}
            type="button"
            role="listitem"
            disabled={isBusy}
            onClick={() => handleSwitch(row)}
            class={cn(
              "flex items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left",
              "transition-colors hover:border-blue-500/60 disabled:opacity-60",
            )}
          >
            {rowInner}
          </button>
        );
      })}
    </div>
  );
}

/**
 * AccountList — multi-session account picker / switcher.
 *
 * Self-contained: it figures out which surface it's running on (admin vs
 * customer) from the current hostname and computes the cross-host target
 * by swapping the `manage.` subdomain. The active session id is read from
 * `authClient.getSession()` on mount. This lets the island be embedded
 * without any prop drilling — drop it anywhere a switcher should appear.
 *
 * Behaviour:
 *   - Empty list → renders nothing (the caller can still render its own
 *     "no accounts" UI).
 *   - One row → still shown (e.g. on the login page so the user sees
 *     "you're already signed in as X").
 *   - Multiple rows → click row to call `setActive`; if the row's role
 *     is the same surface, refresh in place; if different, hard-nav to
 *     the matching host. The session cookie is shared across
 *     `.example.com`, so the destination picks up the new active.
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

  return (
    <div
      class={cn("flex flex-col gap-1", className)}
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
      {sessions.map((row) => {
        const isActive = row.session.id === activeSessionId;
        const isBusy = busyId === row.session.id;
        const surface = roleSurface(row.user.role);
        const Icon = surface === "admin" ? ShieldCheck : UserIcon;
        const label = row.user.name || row.user.email;
        return (
          <button
            key={row.session.id}
            type="button"
            role="listitem"
            disabled={isBusy}
            onClick={() => handleSwitch(row)}
            class={cn(
              "flex items-center gap-2 rounded-md px-2 py-1.5 text-left",
              "transition-colors hover:bg-accent disabled:opacity-60",
              isActive && "bg-accent/60",
            )}
          >
            <span
              class={cn(
                "inline-flex size-7 shrink-0 items-center justify-center rounded-full",
                surface === "admin"
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "bg-primary/10 text-primary",
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
            <span class="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              {surface === "admin" ? "Admin" : "Customer"}
              {isActive && (
                <Check
                  class="size-3.5 text-foreground"
                  aria-label="Current account"
                />
              )}
            </span>
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
                  "ml-1 inline-flex size-6 shrink-0 items-center justify-center rounded",
                  "text-muted-foreground hover:bg-destructive/10 hover:text-destructive",
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
          </button>
        );
      })}
    </div>
  );
}

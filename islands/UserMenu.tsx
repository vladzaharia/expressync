/**
 * UserMenu — top-bar right-cluster dropdown.
 *
 * Renders the signed-in user's avatar as the trigger and a dropdown with:
 *   - Name / email / role header
 *   - Theme toggle (reuses `useThemeToggle` from ThemeToggle island so the
 *     UI reflects and mutates the global html.dark class + localStorage key)
 *   - Sign Out (POST /api/auth/sign-out, then navigate to /login — mirrors
 *     the handler previously in AppSidebar)
 */

import { useEffect, useState } from "preact/hooks";
import { LogOut, Moon, Plus, Sun, User as UserIcon } from "lucide-preact";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.tsx";
import { useThemeToggle } from "@/islands/ThemeToggle.tsx";
import AccountList from "@/islands/auth/AccountList.tsx";
import { cn } from "@/src/lib/utils/cn.ts";
import { signOutAndRedirect } from "@/src/lib/nav.ts";
import { authClient } from "@/src/lib/auth-client.ts";

interface UserMenuProps {
  user?: {
    name?: string | null;
    email: string;
    role?: string | null;
  };
}

const STORAGE_KEY = "ev-billing-theme";

export default function UserMenu({ user }: UserMenuProps) {
  const toggleTheme = useThemeToggle();
  const [isDark, setIsDark] = useState(true);
  const [hasMultiple, setHasMultiple] = useState(false);

  // Track the actual theme on the document so the menu icon/label stay in sync.
  useEffect(() => {
    const read = () =>
      setIsDark(document.documentElement.classList.contains("dark"));
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    // Respond to cross-tab changes.
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) read();
    };
    globalThis.addEventListener("storage", onStorage);
    return () => {
      mo.disconnect();
      globalThis.removeEventListener("storage", onStorage);
    };
  }, []);

  // Probe device-session count once on mount so the menu can show the
  // switcher only when there's more than one. Failure is silent — the
  // menu still works, the switcher just doesn't appear.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authClient.multiSession.listDeviceSessions();
        if (cancelled) return;
        const count = (res.data ?? []).length;
        setHasMultiple(count > 1);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSignOut = () => signOutAndRedirect("/login");

  // The "add another account" link points at the *other* portal's login.
  // Cookie domain is shared across .example.com, so signing in there
  // adds a session to this device which then appears in the switcher.
  const otherPortalLoginHref = (() => {
    if (typeof globalThis.location === "undefined") return "/login";
    const host = globalThis.location.hostname;
    const port = globalThis.location.port ? `:${globalThis.location.port}` : "";
    const proto = globalThis.location.protocol;
    if (host === "localhost" || host === "127.0.0.1") {
      // Pure-loopback dev — same host serves both. The login page already
      // routes by surface heuristics, so just send them to /login.
      return "/login";
    }
    const isAdmin = host.startsWith("manage.");
    const otherHost = isAdmin ? host.slice("manage.".length) : `manage.${host}`;
    return `${proto}//${otherHost}${port}/login`;
  })();

  const displayName = user?.name || user?.email || "User";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Account menu for ${displayName}`}
          className={cn(
            "inline-flex items-center justify-center size-9 rounded-full",
            "bg-primary/10 hover:bg-primary/20 text-primary",
            "transition-colors shrink-0",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <UserIcon className="size-4" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="min-w-[14rem]"
      >
        {user && (
          <>
            <DropdownMenuLabel>
              <div class="flex flex-col min-w-0">
                <span class="text-sm font-medium truncate">{displayName}</span>
                <span class="text-xs text-muted-foreground truncate">
                  {user.email}
                </span>
                {user.role && (
                  <span class="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">
                    {user.role}
                  </span>
                )}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {hasMultiple && (
              <>
                <DropdownMenuLabel class="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Switch account
                </DropdownMenuLabel>
                <div class="px-1 pb-1">
                  <AccountList />
                </div>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem asChild>
              <a href={otherPortalLoginHref}>
                <Plus className="size-4" />
                <span>Sign in to another account</span>
              </a>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem
          onSelect={(e: Event) => {
            // Keep the menu open isn't required, but don't trigger nav.
            e.preventDefault?.();
            toggleTheme();
          }}
        >
          {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          <span>{isDark ? "Light mode" : "Dark mode"}</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={handleSignOut}>
          <LogOut className="size-4" />
          <span>Sign Out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

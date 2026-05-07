/**
 * UserMenu — top-bar right-cluster dropdown.
 *
 * Renders the signed-in user's avatar as the trigger and a dropdown
 * whose top section IS the AccountList: the active row (green border)
 * doubles as the user header, with any other device sessions below as
 * clickable switch targets. Below the picker:
 *   - "Sign in to another account" → /switch on customer host
 *   - Theme toggle
 *   - Sign Out
 */

import { useEffect, useState } from "preact/hooks";
import { LogOut, Moon, Plus, Sun, User as UserIcon } from "lucide-preact";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.tsx";
import { useThemeToggle } from "@/islands/ThemeToggle.tsx";
import AccountList from "@/islands/auth/AccountList.tsx";
import { cn } from "@/src/lib/utils/cn.ts";
import { signOutAndRedirect } from "@/src/lib/nav.ts";

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

  const handleSignOut = () => signOutAndRedirect("/login");

  // "Sign in to another account" routes the visitor to the canonical
  // `/switch` picker on the customer host. Cookie domain is shared
  // across `.example.com`, so all sessions on the device — admin
  // or customer — show up there. From the picker the user picks an
  // existing session or jumps to a fresh login.
  const switchHref = (() => {
    if (typeof globalThis.location === "undefined") return "/switch";
    const host = globalThis.location.hostname;
    const port = globalThis.location.port ? `:${globalThis.location.port}` : "";
    const proto = globalThis.location.protocol;
    if (host === "localhost" || host === "127.0.0.1") {
      // Pure-loopback dev — same host serves both surfaces.
      return "/switch";
    }
    if (host.startsWith("manage.")) {
      const customerHost = host.slice("manage.".length);
      return `${proto}//${customerHost}${port}/switch`;
    }
    return "/switch";
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
            {
              /*
              The picker IS the user header. The active row (green
              border) carries the same info the old DropdownMenuLabel
              did — name, email, role-tinted icon — and any other
              sessions trail it as switchable rows. AccountList renders
              nothing for an unauthenticated visitor, but UserMenu only
              mounts when `user` is truthy so we always have at least
              the active row here.
            */
            }
            <div class="px-1 py-1">
              <AccountList />
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <a href={switchHref}>
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

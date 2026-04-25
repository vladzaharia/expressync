/**
 * UserAvatarMenu (island) — circular avatar with initials, opens a
 * dropdown with Profile / Theme toggle / Sign out.
 *
 * Differences from `islands/UserMenu.tsx`:
 *   • Trigger renders the user's initials inside a colored circle (vs. a
 *     generic User icon) — a more "customer-portal" affordance than a flat
 *     icon button.
 *   • Includes a Profile menu item that links to `/account` (admin's
 *     UserMenu doesn't, since admins don't have an account page).
 *   • Sign-out posts to `/api/auth/sign-out` then redirects to `/login`,
 *     same flow as the admin variant.
 *
 * Re-exported as the default of `components/UserAvatarMenu.tsx` so callers
 * can import from the documented `components/` path even though the
 * implementation lives in `islands/` (Fresh requires islands at the root).
 */

import { useEffect, useState } from "preact/hooks";
import { LogOut, Moon, Sun, User as UserIcon } from "lucide-preact";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.tsx";
import { useThemeToggle } from "@/islands/ThemeToggle.tsx";
import { cn } from "@/src/lib/utils/cn.ts";
import { clientNavigate, signOutAndRedirect } from "@/src/lib/nav.ts";

interface UserAvatarMenuProps {
  user?: {
    id?: string;
    name?: string | null;
    /** Null for customers auto-provisioned from emailless Lago records. */
    email?: string | null;
    role?: string | null;
  };
}

const STORAGE_KEY = "ev-billing-theme";

function initials(nameOrEmail: string): string {
  const trimmed = nameOrEmail.trim();
  if (!trimmed) return "?";
  // If it looks like an email, use the local-part.
  const head = trimmed.includes("@") ? trimmed.split("@")[0] : trimmed;
  const parts = head.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return head.slice(0, 2).toUpperCase();
}

export default function UserAvatarMenu({ user }: UserAvatarMenuProps) {
  const toggleTheme = useThemeToggle();
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    const read = () =>
      setIsDark(document.documentElement.classList.contains("dark"));
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
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

  const displayName = user?.name || user?.email || "Guest";
  const initialsText = user
    ? initials(user.name || user.email || "Guest")
    : "?";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Account menu for ${displayName}`}
          className={cn(
            "inline-flex items-center justify-center size-9 rounded-full",
            "bg-gradient-to-br from-cyan-500/30 to-blue-500/30 text-foreground",
            "ring-1 ring-cyan-500/40 hover:ring-cyan-500/60",
            "transition-all shrink-0 font-semibold text-xs tabular-nums",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          {user ? initialsText : <UserIcon class="size-4" aria-hidden="true" />}
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
                {user.email
                  ? (
                    <span class="text-xs text-muted-foreground truncate">
                      {user.email}
                    </span>
                  )
                  : (
                    <span class="text-[10px] uppercase tracking-wider text-muted-foreground">
                      no email on file
                    </span>
                  )}
                {user.role && (
                  <span class="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">
                    {user.role}
                  </span>
                )}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => clientNavigate("/account")}
            >
              <UserIcon class="size-4" />
              <span>Profile</span>
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuItem
          onSelect={(e: Event) => {
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

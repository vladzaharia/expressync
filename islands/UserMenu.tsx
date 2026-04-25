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

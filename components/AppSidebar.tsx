import * as React from "preact/compat";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  useSidebar,
} from "./ui/sidebar.tsx";
import ThemeToggle, { useThemeToggle } from "../islands/ThemeToggle.tsx";
import {
  LayoutDashboard,
  Link2,
  LogOut,
  Receipt,
  RefreshCw,
  User,
} from "lucide-preact";
import { cn } from "@/src/lib/utils/cn.ts";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./ui/tooltip.tsx";
import { BorderBeam } from "./magicui/border-beam.tsx";
import { Particles } from "./magicui/particles.tsx";
import { ExpresSyncBrand } from "./brand/ExpresSyncBrand.tsx";
import { type AccentColor, accentTailwindClasses } from "@/src/lib/colors.ts";

// Shared chrome size - used by both sidebar and top bar
export const CHROME_SIZE = "3.5rem"; // 56px
const SIDEBAR_EXPANDED_WIDTH = "12rem"; // 192px when expanded

interface UserInfo {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
}

interface AppSidebarProps {
  currentPath: string;
  user?: UserInfo;
}

// Extended accent type to include "primary" for dashboard
type NavAccentColor = AccentColor | "primary";

const mainNavItems: Array<{
  title: string;
  url: string;
  icon: typeof LayoutDashboard;
  accentColor: NavAccentColor;
}> = [
  {
    title: "Dashboard",
    url: "/",
    icon: LayoutDashboard,
    accentColor: "primary",
  },
  {
    title: "Tag Linking",
    url: "/tag-linking",
    icon: Link2,
    accentColor: "violet",
  },
  {
    title: "Transactions",
    url: "/transactions",
    icon: Receipt,
    accentColor: "green",
  },
  {
    title: "Sync",
    url: "/sync",
    icon: RefreshCw,
    accentColor: "blue",
  },
];

// Accent color to Tailwind class mappings - extends centralized config with "primary"
const accentClasses: Record<NavAccentColor, { bg: string; bgHover: string; text: string; tooltip: string }> = {
  ...accentTailwindClasses,
  primary: {
    bg: "bg-primary/20",
    bgHover: "hover:bg-primary/20",
    text: "text-primary",
    tooltip: "bg-primary/90 text-primary-foreground",
  },
};

// Full-block nav link component
function NavSection({
  href,
  icon: Icon,
  title,
  isActive,
  isCollapsed,
  accentColor,
}: {
  href: string;
  icon: typeof LayoutDashboard;
  title: string;
  isActive: boolean;
  isCollapsed: boolean;
  accentColor: NavAccentColor;
}) {
  const accent = accentClasses[accentColor];

  const content = (
    <a
      href={href}
      className={cn(
        "flex items-center border-b transition-colors shrink-0 cursor-pointer",
        isCollapsed ? "justify-center" : "justify-start gap-3 px-4",
        isActive
          ? cn(accent.bg, accent.text)
          : cn("text-muted-foreground hover:text-foreground", accent.bgHover),
      )}
      style={{ height: CHROME_SIZE, minHeight: CHROME_SIZE }}
    >
      <Icon className="size-5 shrink-0" />
      {!isCollapsed && <span className="text-sm font-medium">{title}</span>}
    </a>
  );

  if (isCollapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent side="right" sideOffset={8} className={accent.tooltip}>
          {title}
        </TooltipContent>
      </Tooltip>
    );
  }

  return content;
}

// Theme toggle section - matches nav items
function ThemeToggleSection({ isCollapsed }: { isCollapsed: boolean }) {
  const toggleTheme = useThemeToggle();

  const content = (
    <button
      onClick={toggleTheme}
      className={cn(
        "flex items-center border-t hover:bg-muted/50 transition-colors cursor-pointer shrink-0 w-full text-muted-foreground hover:text-foreground",
        isCollapsed ? "justify-center" : "gap-3 px-4",
      )}
      style={{ height: CHROME_SIZE, minHeight: CHROME_SIZE }}
    >
      <ThemeToggle />
      {!isCollapsed && (
        <span className="text-sm font-medium">Toggle Theme</span>
      )}
    </button>
  );

  if (isCollapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          Toggle Theme
        </TooltipContent>
      </Tooltip>
    );
  }

  return content;
}

export function AppSidebar({ currentPath, user }: AppSidebarProps) {
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";

  const isActive = (url: string) => {
    if (url === "/") return currentPath === "/";
    return currentPath.startsWith(url);
  };

  const handleSignOut = async () => {
    await fetch("/api/auth/sign-out", { method: "POST" });
    window.location.href = "/login";
  };

  // Logo content - ExpresSync brand
  const logoContent = (
    <a
      href="/"
      className={cn(
        "relative flex items-center border-b transition-colors shrink-0 overflow-hidden group/logo",
        isCollapsed ? "justify-center" : "justify-start gap-3 px-4",
        "bg-gradient-to-br from-primary/5 via-accent/5 to-primary/5",
        !isCollapsed && "hover:from-primary/10 hover:via-accent/10 hover:to-primary/10",
      )}
      style={{ height: CHROME_SIZE, minHeight: CHROME_SIZE }}
    >
      {/* Particles effect */}
      <Particles
        className="absolute inset-0"
        quantity={isCollapsed ? 8 : 15}
        size={0.3}
        color="hsl(var(--primary))"
        staticity={30}
        ease={80}
      />

      {/* ExpresSync brand */}
      <ExpresSyncBrand
        variant={isCollapsed ? "sidebar-collapsed" : "sidebar-expanded"}
      />

      {/* Border beam effect */}
      <BorderBeam
        size={50}
        duration={2}
        colorFrom="hsl(var(--primary))"
        colorTo="hsl(var(--accent))"
        className="opacity-80"
      />
      <BorderBeam
        size={50}
        duration={2}
        delay={1}
        colorFrom="hsl(var(--accent))"
        colorTo="hsl(var(--primary))"
        className="opacity-60"
        reverse
      />
    </a>
  );

  return (
    <Sidebar
      collapsible="icon"
      style={{
        "--sidebar-width": SIDEBAR_EXPANDED_WIDTH,
        "--sidebar-width-icon": CHROME_SIZE,
      } as React.CSSProperties}
    >
      {/* Logo section with glow effect */}
      {isCollapsed ? (
        <Tooltip>
          <TooltipTrigger asChild>{logoContent}</TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            ExpresSync
          </TooltipContent>
        </Tooltip>
      ) : (
        logoContent
      )}

      {/* Main nav sections */}
      <SidebarContent className="flex flex-col p-0 gap-0">
        {mainNavItems.map((item) => (
          <NavSection
            key={item.title}
            href={item.url}
            icon={item.icon}
            title={item.title}
            isActive={isActive(item.url)}
            isCollapsed={isCollapsed}
            accentColor={item.accentColor}
          />
        ))}
      </SidebarContent>

      {/* Footer sections */}
      <SidebarFooter className="p-0 mt-auto gap-0">
        {/* Theme toggle section - matches nav items exactly */}
        <ThemeToggleSection isCollapsed={isCollapsed} />

        {/* User info section */}
        {user && (
          <div
            className={cn(
              "flex items-center border-t bg-primary/5 hover:bg-primary/10 transition-colors shrink-0",
              isCollapsed ? "justify-center" : "gap-3 px-4",
            )}
            style={{ height: CHROME_SIZE, minHeight: CHROME_SIZE }}
          >
            <User className="size-5 text-primary shrink-0" />
            {!isCollapsed && (
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-medium truncate">
                  {user.name || "User"}
                </span>
                <span className="text-xs text-muted-foreground truncate">
                  {user.email}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Sign out section - dark red background */}
        {(() => {
          const signOutContent = (
            <button
              onClick={handleSignOut}
              className={cn(
                "flex items-center border-t bg-red-950/50 hover:bg-red-950/70 text-red-400 hover:text-red-300 transition-colors w-full shrink-0 cursor-pointer",
                isCollapsed ? "justify-center" : "gap-3 px-4",
              )}
              style={{ height: CHROME_SIZE, minHeight: CHROME_SIZE }}
            >
              <LogOut className="size-5 shrink-0" />
              {!isCollapsed && <span className="text-sm font-medium">Sign Out</span>}
            </button>
          );

          return isCollapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>{signOutContent}</TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                Sign Out
              </TooltipContent>
            </Tooltip>
          ) : signOutContent;
        })()}
      </SidebarFooter>
    </Sidebar>
  );
}

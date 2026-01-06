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
  PanelLeftClose,
  PanelLeftOpen,
  Receipt,
  RefreshCw,
  User,
} from "lucide-preact";
import { cn } from "@/src/lib/utils/cn.ts";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip.tsx";
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
export type NavAccentColor = AccentColor | "primary";

export const mainNavItems: Array<{
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
    url: "/links",
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
export const accentClasses: Record<
  NavAccentColor,
  { bg: string; bgHover: string; text: string; tooltip: string }
> = {
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
        <span className="text-sm font-medium">
          Toggle Theme
        </span>
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
  const { state, toggleSidebar, isMobile } = useSidebar();
  const isCollapsed = state === "collapsed";

  const isActive = (url: string) => {
    if (url === "/") return currentPath === "/";
    return currentPath.startsWith(url);
  };

  const handleSignOut = async () => {
    await fetch("/api/auth/sign-out", { method: "POST" });
    window.location.href = "/login";
  };

  const toggleTheme = useThemeToggle();

  // Mobile layout - horizontal navigation bar
  if (isMobile) {
    return (
      <Sidebar
        collapsible="icon"
        style={{
          "--sidebar-width": SIDEBAR_EXPANDED_WIDTH,
          "--sidebar-width-icon": CHROME_SIZE,
        } as React.CSSProperties}
      >
        {/* Left section: Logo + Nav items */}
        <div className="flex items-center h-full">
          {/* Compact logo - no toggle functionality */}
          <a
            href="/"
            className={cn(
              "relative flex items-center justify-center shrink-0",
              "bg-gradient-to-br from-primary/5 via-accent/5 to-primary/5",
            )}
            style={{ width: CHROME_SIZE, height: CHROME_SIZE }}
          >
            <ExpresSyncBrand variant="sidebar-collapsed" />
          </a>

          {/* Nav items as icons - square buttons */}
          {mainNavItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.url);
            const accent = accentClasses[item.accentColor];

            return (
              <Tooltip key={item.title}>
                <TooltipTrigger asChild>
                  <a
                    href={item.url}
                    className={cn(
                      "flex items-center justify-center shrink-0 transition-colors",
                      active
                        ? cn(accent.bg, accent.text)
                        : cn(
                            "text-muted-foreground hover:text-foreground",
                            accent.bgHover,
                          ),
                    )}
                    style={{ width: CHROME_SIZE, height: CHROME_SIZE }}
                  >
                    <Icon className="size-5" />
                  </a>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={8}>
                  {item.title}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right section: Theme, User, Logout - square buttons */}
        <div className="flex items-center h-full">
          {/* Theme toggle */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={toggleTheme}
                className="flex items-center justify-center shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                style={{ width: CHROME_SIZE, height: CHROME_SIZE }}
              >
                <ThemeToggle />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={8}>
              Toggle Theme
            </TooltipContent>
          </Tooltip>

          {/* User icon */}
          {user && (
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className="flex items-center justify-center shrink-0 text-primary bg-primary/5"
                  style={{ width: CHROME_SIZE, height: CHROME_SIZE }}
                >
                  <User className="size-5" />
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={8}>
                {user.name || user.email}
              </TooltipContent>
            </Tooltip>
          )}

          {/* Sign out */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleSignOut}
                className="flex items-center justify-center shrink-0 bg-red-950/50 hover:bg-red-950/70 text-red-400 hover:text-red-300 transition-colors"
                style={{ width: CHROME_SIZE, height: CHROME_SIZE }}
              >
                <LogOut className="size-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={8} className={accentClasses.red.tooltip}>
              Sign Out
            </TooltipContent>
          </Tooltip>
        </div>
      </Sidebar>
    );
  }

  // Desktop layout - vertical sidebar (existing code)
  // Logo content - ExpresSync brand that morphs to sidebar toggle on hover
  const logoContent = (
    <button
      onClick={toggleSidebar}
      className={cn(
        "relative flex items-center border-b transition-colors shrink-0 overflow-hidden group/logo cursor-pointer w-full",
        isCollapsed ? "justify-center" : "justify-start gap-3 px-4",
        "bg-gradient-to-br from-primary/5 via-accent/5 to-primary/5",
        "hover:from-primary/10 hover:via-accent/10 hover:to-primary/10",
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

      {/* Default state: ExpresSync brand */}
      <div className="flex items-center gap-3 transition-all duration-200 group-hover/logo:opacity-0 group-hover/logo:scale-90">
        <ExpresSyncBrand
          variant={isCollapsed ? "sidebar-collapsed" : "sidebar-expanded"}
        />
      </div>

      {/* Hover state: Sidebar toggle */}
      <div
        className={cn(
          "absolute inset-0 flex items-center transition-all duration-200 opacity-0 scale-110 group-hover/logo:opacity-100 group-hover/logo:scale-100",
          isCollapsed ? "justify-center" : "justify-start gap-3 px-4",
        )}
      >
        {isCollapsed ? <PanelLeftOpen className="size-5 text-primary" /> : (
          <>
            <PanelLeftClose className="size-5 text-primary shrink-0" />
            <span className="text-sm font-medium">Close Sidebar</span>
          </>
        )}
      </div>

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
      />
    </button>
  );

  return (
    <Sidebar
      collapsible="icon"
      style={{
        "--sidebar-width": SIDEBAR_EXPANDED_WIDTH,
        "--sidebar-width-icon": CHROME_SIZE,
      } as React.CSSProperties}
    >
      {/* Logo section with sidebar toggle on hover */}
      {isCollapsed
        ? (
          <Tooltip>
            <TooltipTrigger asChild>{logoContent}</TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              Open Sidebar
            </TooltipContent>
          </Tooltip>
        )
        : logoContent}

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
              {!isCollapsed && (
                <span className="text-sm font-medium">Sign Out</span>
              )}
            </button>
          );

          return isCollapsed
            ? (
              <Tooltip>
                <TooltipTrigger asChild>{signOutContent}</TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  Sign Out
                </TooltipContent>
              </Tooltip>
            )
            : signOutContent;
        })()}
      </SidebarFooter>
    </Sidebar>
  );
}

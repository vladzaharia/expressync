import * as React from "preact/compat";
import type { ComponentType } from "preact";
import { useState } from "preact/hooks";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  useSidebar,
} from "./ui/sidebar.tsx";
import ThemeToggle, { useThemeToggle } from "../islands/ThemeToggle.tsx";
import NotificationBell from "../islands/NotificationBell.tsx";
import FleetLivePill from "../islands/admin/FleetLivePill.tsx";
import {
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  User,
} from "lucide-preact";
import { cn } from "@/src/lib/utils/cn.ts";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip.tsx";
import { Sheet, SheetContent, SheetTitle } from "./ui/sheet.tsx";
import { BorderBeam } from "./magicui/border-beam.tsx";
import { Particles } from "./magicui/particles.tsx";
import { ExpresSyncBrand } from "./brand/ExpresSyncBrand.tsx";
import { PolarisExpressBrand } from "./brand/PolarisExpressBrand.tsx";
import { MobileBottomTabBar } from "./customer/MobileBottomTabBar.tsx";
import { type AccentColor, accentTailwindClasses } from "@/src/lib/colors.ts";
import {
  ADMIN_NAV_SECTIONS,
  isPathActive,
  type NavItem,
  type NavSection,
} from "@/src/lib/admin-navigation.ts";
import { clientNavigate } from "@/src/lib/nav.ts";

// Shared chrome size - used by both sidebar and top bar
export const CHROME_SIZE = "3.5rem"; // 56px
const SIDEBAR_EXPANDED_WIDTH = "12rem"; // 192px when expanded

interface UserInfo {
  id: string;
  name: string | null | undefined;
  email: string;
  image?: string | null | undefined;
  role?: string | null | undefined;
}

/**
 * Brand-component shape — mirrors both `ExpresSyncBrand` and
 * `PolarisExpressBrand` so callers can swap surfaces without changing the
 * sidebar's render call site.
 */
type BrandVariant =
  | "logo-only"
  | "sidebar-collapsed"
  | "sidebar-expanded"
  | "login"
  | "header-mobile";
type BrandComponent = ComponentType<
  { variant?: BrandVariant; className?: string }
>;

interface AppSidebarProps {
  currentPath: string;
  user?: UserInfo;
  /**
   * Polaris Track A: nav module to render. Defaults to `ADMIN_NAV_SECTIONS`
   * for backwards compatibility — customer pages pass
   * `CUSTOMER_NAV_SECTIONS` from `src/lib/customer-navigation.ts`.
   */
  navSections?: NavSection[];
  /**
   * Polaris Track A: which UI surface this sidebar serves. Drives the
   * default brand component and (eventually) the mobile shell pattern.
   * Defaults to "admin" so existing admin pages keep their previous
   * behavior unchanged.
   */
  role?: "admin" | "customer";
  /**
   * Polaris Track A: explicit override for the brand component. When
   * omitted, defaults to ExpresSyncBrand for `role="admin"` and
   * PolarisExpressBrand for `role="customer"`.
   */
  brandComponent?: BrandComponent;
}

// Extended accent type to include "primary" for dashboard
export type NavAccentColor = AccentColor | "primary";

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

// Admin mobile nav Sheet — hamburger trigger + left-side slide-out panel
// that renders the full grouped IA (Operations / Billing / Identity / Admin).
// Replaces the horizontal icon strip that clipped off-screen above ~6 items.
function AdminNavSheet(
  { visibleSections, isActive }: {
    visibleSections: { id: string; title: string; items: NavItem[] }[];
    isActive: (url: string) => boolean;
  },
) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        className="flex items-center justify-center shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        style={{ width: CHROME_SIZE, height: CHROME_SIZE }}
      >
        <Menu className="size-5" />
      </button>
      <SheetContent side="left" className="w-72 max-w-[85vw] p-0">
        <SheetTitle className="sr-only">Admin navigation</SheetTitle>
        <nav className="flex flex-col h-full overflow-y-auto">
          {visibleSections.map((section, sIdx) => (
            <div key={section.id} className="flex flex-col">
              {section.title && (
                <div
                  className={cn(
                    "px-4 pt-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground shrink-0",
                    sIdx > 0 && "border-t",
                  )}
                >
                  {section.title}
                </div>
              )}
              {section.items.map((item) => {
                const Icon = item.icon;
                const accent = accentClasses[item.accentColor];
                const active = isActive(item.path);
                return (
                  <a
                    key={item.id}
                    href={item.path}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex items-center gap-3 px-4 border-b transition-colors shrink-0",
                      active
                        ? cn(accent.bg, accent.text)
                        : cn(
                          "text-muted-foreground hover:text-foreground",
                          accent.bgHover,
                        ),
                    )}
                    style={{ height: CHROME_SIZE, minHeight: CHROME_SIZE }}
                  >
                    <Icon className="size-5 shrink-0" />
                    <span className="text-sm font-medium">{item.title}</span>
                  </a>
                );
              })}
            </div>
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  );
}

// Full-block nav link component
function NavSectionLink({
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

export function AppSidebar({
  currentPath,
  user,
  navSections = ADMIN_NAV_SECTIONS,
  role = "admin",
  brandComponent,
}: AppSidebarProps) {
  const { state, toggleSidebar, isMobile } = useSidebar();
  const isCollapsed = state === "collapsed";
  const isAdmin = user?.role === "admin";

  const isActive = (url: string) => isPathActive(url, currentPath);

  // Resolve the brand component from explicit prop, role, or fall back to
  // ExpresSync (matches pre-Polaris default).
  const Brand: BrandComponent = brandComponent ??
    (role === "customer"
      ? (PolarisExpressBrand as BrandComponent)
      : (ExpresSyncBrand as BrandComponent));

  // Filter nav sections by role — admin-only filter only applies to the
  // admin nav; the customer nav module never sets `adminOnly`, so this
  // works uniformly for both surfaces.
  const visibleSections = navSections
    .filter((s) => !s.adminOnly || isAdmin)
    .map((s) => ({
      ...s,
      items: s.items.filter((i) => !i.adminOnly || isAdmin),
    }))
    .filter((s) => s.items.length > 0);

  // Flat list (used by the mobile horizontal bar fallback).
  const flatNavItems: NavItem[] = visibleSections.flatMap((s) => s.items);

  const handleSignOut = async () => {
    await fetch("/api/auth/sign-out", { method: "POST" });
    clientNavigate("/login");
  };

  const toggleTheme = useThemeToggle();

  // Mobile layout — two distinct shells:
  //   • admin → top bar with hamburger that opens a left-side Sheet with
  //     the full grouped nav. Fixes the clipping bug where >6 icon buttons
  //     overflowed off-screen on a phone-width viewport.
  //   • customer → slim top bar (logo + right cluster) with primary nav
  //     delegated to the fixed bottom tab bar.
  if (isMobile) {
    const rightCluster = (
      <div className="flex items-center h-full">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={toggleTheme}
              className="flex items-center justify-center shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              style={{ width: CHROME_SIZE, height: CHROME_SIZE }}
              aria-label="Toggle theme"
            >
              <ThemeToggle />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={8}>Toggle Theme</TooltipContent>
        </Tooltip>

        <NotificationBell variant="mobile" />

        {role !== "customer" && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() =>
                  globalThis.dispatchEvent(new CustomEvent("cmdk:open"))}
                aria-label="Open command palette"
                className="flex items-center justify-center shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors font-mono text-sm"
                style={{ width: CHROME_SIZE, height: CHROME_SIZE }}
              >
                <span aria-hidden="true">⌘K</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={8}>Command Palette</TooltipContent>
          </Tooltip>
        )}

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

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={handleSignOut}
              className="flex items-center justify-center shrink-0 bg-red-950/50 hover:bg-red-950/70 text-red-400 hover:text-red-300 transition-colors"
              style={{ width: CHROME_SIZE, height: CHROME_SIZE }}
              aria-label="Sign out"
            >
              <LogOut className="size-5" />
            </button>
          </TooltipTrigger>
          <TooltipContent
            side="bottom"
            sideOffset={8}
            className={accentClasses.red.tooltip}
          >
            Sign Out
          </TooltipContent>
        </Tooltip>
      </div>
    );

    const logoAnchor = (
      <a
        href="/"
        className={cn(
          "relative flex items-center justify-center shrink-0",
          "bg-gradient-to-br from-primary/5 via-accent/5 to-primary/5",
        )}
        style={{ width: CHROME_SIZE, height: CHROME_SIZE }}
        aria-label="Go to dashboard"
      >
        <Brand variant="sidebar-collapsed" />
      </a>
    );

    if (role === "customer") {
      return (
        <>
          <Sidebar
            collapsible="icon"
            style={{
              "--sidebar-width": SIDEBAR_EXPANDED_WIDTH,
              "--sidebar-width-icon": CHROME_SIZE,
            } as React.CSSProperties}
          >
            <div className="flex items-center h-full">{logoAnchor}</div>
            <div className="flex-1" />
            {rightCluster}
          </Sidebar>
          <MobileBottomTabBar currentPath={currentPath} />
        </>
      );
    }

    // Admin mobile: hamburger + logo + right cluster. Nav lives in Sheet.
    return (
      <Sidebar
        collapsible="icon"
        style={{
          "--sidebar-width": SIDEBAR_EXPANDED_WIDTH,
          "--sidebar-width-icon": CHROME_SIZE,
        } as React.CSSProperties}
      >
        <div className="flex items-center h-full">
          <AdminNavSheet
            visibleSections={visibleSections}
            isActive={isActive}
          />
          {logoAnchor}
        </div>
        <div className="flex-1" />
        {rightCluster}
      </Sidebar>
    );
  }

  // Desktop layout — vertical sidebar. The logo links home; the sidebar
  // collapse/expand is driven by the footer toggle + Ctrl+B shortcut.
  const logoContent = (
    <a
      href="/"
      className={cn(
        "relative flex items-center border-b transition-colors shrink-0 overflow-hidden w-full",
        isCollapsed ? "justify-center" : "justify-start gap-3 px-4",
        "bg-gradient-to-br from-primary/5 via-accent/5 to-primary/5",
        "hover:from-primary/10 hover:via-accent/10 hover:to-primary/10",
      )}
      style={{ height: CHROME_SIZE, minHeight: CHROME_SIZE }}
      aria-label="Go to dashboard"
    >
      <Particles
        className="absolute inset-0"
        quantity={isCollapsed ? 8 : 15}
        size={0.3}
        color="hsl(var(--primary))"
        staticity={30}
        ease={80}
      />

      <div className="flex items-center gap-3">
        <Brand
          variant={isCollapsed ? "sidebar-collapsed" : "sidebar-expanded"}
        />
      </div>

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
      {/* Logo — always a link to the dashboard. */}
      {isCollapsed
        ? (
          <Tooltip>
            <TooltipTrigger asChild>{logoContent}</TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              Dashboard
            </TooltipContent>
          </Tooltip>
        )
        : logoContent}

      {/* Main nav sections */}
      <SidebarContent className="flex flex-col p-0 gap-0">
        {visibleSections.map((section, sIdx) => (
          <div key={section.id} className="flex flex-col">
            {!isCollapsed && section.title && (
              <div
                className={cn(
                  "px-4 pt-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground shrink-0",
                  sIdx > 0 && "border-t",
                )}
              >
                {section.title}
              </div>
            )}
            {isCollapsed && sIdx > 0 && (
              <div className="border-t" aria-hidden="true" />
            )}
            {section.items.map((item) => (
              <NavSectionLink
                key={item.id}
                href={item.path}
                icon={item.icon}
                title={item.title}
                isActive={isActive(item.path)}
                isCollapsed={isCollapsed}
                accentColor={item.accentColor}
              />
            ))}
          </div>
        ))}
      </SidebarContent>

      {
        /* Footer sections — Wave B1: theme, bell, and user menu moved to top
          bar; keep a subtle user-summary line (expanded desktop only) so the
          sidebar still shows who's signed in, then the sign-out button. */
      }
      <SidebarFooter className="p-0 mt-auto gap-0">
        {isAdmin && !isCollapsed && (
          <div class="flex items-center justify-center border-t px-3 py-2 shrink-0">
            <FleetLivePill />
          </div>
        )}
        {user && !isCollapsed && (
          <div className="flex items-center gap-3 px-4 py-2 border-t text-muted-foreground shrink-0">
            <User className="size-4 text-primary shrink-0" aria-hidden="true" />
            <div className="flex flex-col min-w-0">
              <span className="text-xs font-medium truncate text-foreground">
                {user.name || "User"}
              </span>
              <span className="text-[11px] text-muted-foreground truncate">
                {user.email}
              </span>
            </div>
          </div>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={toggleSidebar}
              aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              className={cn(
                "flex items-center border-t text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors shrink-0 cursor-pointer",
                isCollapsed ? "justify-center" : "justify-start gap-3 px-4",
              )}
              style={{ height: CHROME_SIZE, minHeight: CHROME_SIZE }}
            >
              {isCollapsed
                ? <PanelLeftOpen className="size-5 shrink-0" />
                : <PanelLeftClose className="size-5 shrink-0" />}
              {!isCollapsed && (
                <span className="text-sm font-medium">Collapse</span>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            {isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          </TooltipContent>
        </Tooltip>
      </SidebarFooter>
    </Sidebar>
  );
}

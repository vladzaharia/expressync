import type { ComponentChildren, ComponentType } from "preact";
import {
  SidebarInset,
  SidebarProvider,
  useSidebar,
} from "@/components/ui/sidebar.tsx";
import { AppSidebar, CHROME_SIZE } from "@/components/AppSidebar.tsx";
import { ExpresSyncBrand } from "@/components/brand/ExpresSyncBrand.tsx";
import { PolarisExpressBrand } from "@/components/brand/PolarisExpressBrand.tsx";
import { SectionNav } from "@/components/SectionNav.tsx";
import PaletteTriggerPill from "@/islands/PaletteTriggerPill.tsx";
import NotificationBell from "@/islands/NotificationBell.tsx";
import UserMenu from "@/islands/UserMenu.tsx";

// Shared shape used by `AppSidebar.brandComponent`. ExpresSyncBrand doesn't
// declare the "header-mobile" variant (only Polaris does), but AppSidebar
// never invokes that variant on desktop, so widening via a cast is safe.
type SidebarBrandComponent = ComponentType<
  {
    variant?:
      | "logo-only"
      | "sidebar-collapsed"
      | "sidebar-expanded"
      | "login"
      | "header-mobile";
    className?: string;
  }
>;
import { cn } from "@/src/lib/utils/cn.ts";
import { type AccentColor, accentTailwindClasses } from "@/src/lib/colors.ts";
import { ADMIN_NAV_SECTIONS } from "@/src/lib/admin-navigation.ts";
import { CUSTOMER_NAV_SECTIONS } from "@/src/lib/customer-navigation.ts";

interface User {
  id: string;
  name: string | null | undefined;
  email: string;
  image?: string | null | undefined;
  role?: string | null | undefined;
}

interface SidebarWrapperProps {
  children: ComponentChildren;
  currentPath: string;
  title?: string;
  description?: string;
  actions?: ComponentChildren;
  accentColor?: AccentColor;
  user?: User;
  /**
   * Polaris Track A: surface role. The matching nav module is looked up
   * inside this island — passing the nav array as a prop would force
   * Fresh's hydration serializer to encode the icon component
   * references, which throws "Serializing functions is not supported".
   */
  role?: "admin" | "customer";
}

function TopBarContent({
  currentPath,
  actions,
  accentColor = "blue",
  user,
  role = "admin",
}: Pick<
  SidebarWrapperProps,
  "currentPath" | "actions" | "accentColor" | "user" | "role"
>) {
  const { isMobile } = useSidebar();

  // On mobile, the "top bar" is rendered by AppSidebar itself — don't double
  // up here. Admin shell previously hid the header if there were no actions;
  // we now always render it on desktop for SectionNav + right-cluster chrome.
  if (isMobile) return null;

  const colorClasses = accentTailwindClasses[accentColor];
  const accentBgClass =
    `${colorClasses.bg} ${colorClasses.bgHover} ${colorClasses.text}`;

  return (
    <header
      className="hidden md:flex shrink-0 items-stretch border-b bg-background sticky top-0 z-10"
      style={{ height: CHROME_SIZE }}
    >
      {/* Left: section breadcrumb, fills available space */}
      <div className="flex-1 min-w-0 flex items-center">
        <SectionNav currentPath={currentPath} />
      </div>

      {/* Center-right: palette trigger pill — admin only. Removed on the
          customer surface (Polaris) so the top bar stays uncluttered. */}
      {role !== "customer" && (
        <div className="flex items-center shrink-0">
          <PaletteTriggerPill />
        </div>
      )}

      {/* Page action section — preserves accent gradient behavior. */}
      {actions && (
        <div
          className={cn(
            "flex items-center justify-center border-l transition-colors",
            accentBgClass,
          )}
        >
          {actions}
        </div>
      )}

      {/* Right cluster: NotificationBell + UserMenu. Sign-out lives in the
          avatar dropdown for both surfaces — no separate icon button. */}
      <div className="flex items-center gap-2 px-3 border-l shrink-0">
        <NotificationBell variant="topbar" />
        <UserMenu user={user} />
      </div>
    </header>
  );
}

export default function SidebarWrapper({
  children,
  currentPath,
  actions,
  accentColor,
  user,
  role = "admin",
}: SidebarWrapperProps) {
  const navSections = role === "customer"
    ? CUSTOMER_NAV_SECTIONS
    : ADMIN_NAV_SECTIONS;
  return (
    <SidebarProvider defaultOpen={false}>
      <AppSidebar
        currentPath={currentPath}
        user={user}
        navSections={navSections}
        role={role}
        brandComponent={(role === "customer"
          ? PolarisExpressBrand
          : ExpresSyncBrand) as SidebarBrandComponent}
      />
      <SidebarInset>
        <TopBarContent
          currentPath={currentPath}
          actions={actions}
          accentColor={accentColor}
          user={user}
          role={role}
        />
        <main
          id="main-content"
          className={cn(
            "flex-1 overflow-auto p-4 md:p-6",
            // Customer mobile has a fixed 64px bottom tab bar; keep page
            // content from slipping underneath it on phone viewports.
            role === "customer" && "pb-20 md:pb-6",
          )}
        >
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

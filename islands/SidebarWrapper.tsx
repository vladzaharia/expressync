import type { ComponentChildren } from "preact";
import {
  SidebarInset,
  SidebarProvider,
  useSidebar,
} from "@/components/ui/sidebar.tsx";
import { AppSidebar, CHROME_SIZE } from "@/components/AppSidebar.tsx";
import { SectionNav } from "@/components/SectionNav.tsx";
import PaletteTriggerPill from "@/islands/PaletteTriggerPill.tsx";
import NotificationBell from "@/islands/NotificationBell.tsx";
import UserMenu from "@/islands/UserMenu.tsx";
import { cn } from "@/src/lib/utils/cn.ts";
import { type AccentColor, accentTailwindClasses } from "@/src/lib/colors.ts";
import {
  ADMIN_NAV_SECTIONS,
  type NavSection,
} from "@/src/lib/admin-navigation.ts";

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
  /** Polaris Track A: nav module forwarded to AppSidebar. */
  navSections?: NavSection[];
  /** Polaris Track A: surface role forwarded to AppSidebar. */
  role?: "admin" | "customer";
}

function TopBarContent({
  currentPath,
  actions,
  accentColor = "blue",
  user,
}: Pick<
  SidebarWrapperProps,
  "currentPath" | "actions" | "accentColor" | "user"
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

      {/* Center-right: palette trigger pill */}
      <div className="flex items-center shrink-0">
        <PaletteTriggerPill />
      </div>

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

      {/* Right cluster: NotificationBell + UserMenu */}
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
  navSections = ADMIN_NAV_SECTIONS,
  role = "admin",
}: SidebarWrapperProps) {
  return (
    <SidebarProvider defaultOpen={false}>
      <AppSidebar
        currentPath={currentPath}
        user={user}
        navSections={navSections}
        role={role}
      />
      <SidebarInset>
        <TopBarContent
          currentPath={currentPath}
          actions={actions}
          accentColor={accentColor}
          user={user}
        />
        <main className="flex-1 overflow-auto p-4 md:p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}

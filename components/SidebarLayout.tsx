import type { ComponentChildren } from "preact";
import SidebarWrapper from "@/islands/SidebarWrapper.tsx";
import { ThemeProvider } from "@/hooks/use-theme.tsx";
import {
  ADMIN_NAV_SECTIONS,
  type NavSection,
} from "@/src/lib/admin-navigation.ts";

interface User {
  id: string;
  // BetterAuth types these as string | null | undefined; accept the wider shape
  // rather than force every caller to normalize.
  name: string | null | undefined;
  email: string;
  image?: string | null | undefined;
  role?: string | null | undefined;
}

/**
 * Polaris Track A — surface role passed down to AppSidebar so it can pick
 * the right brand component, mobile shell, and storage keys. Defaults to
 * "admin" for backwards compatibility with existing admin pages that don't
 * yet pass `role`.
 */
type SurfaceRole = "admin" | "customer";

interface SidebarLayoutProps {
  children: ComponentChildren;
  currentPath: string;
  title?: string; // Kept for backwards compatibility but no longer displayed in top bar
  description?: string; // Kept for backwards compatibility but no longer displayed in top bar
  actions?: ComponentChildren;
  accentColor?: import("@/src/lib/colors.ts").AccentColor;
  user?: User;
  /**
   * Polaris Track A: nav module to render in the sidebar. Defaults to
   * `ADMIN_NAV_SECTIONS` so existing admin callers keep working.
   * Customer pages pass `CUSTOMER_NAV_SECTIONS` from
   * `src/lib/customer-navigation.ts`.
   */
  navSections?: NavSection[];
  /**
   * Polaris Track A: which UI surface this layout serves. Drives brand
   * selection (ExpresSync vs Polaris Express), mobile shell pattern, and
   * the localStorage key used by the theme provider. Defaults to "admin".
   */
  role?: SurfaceRole;
  /**
   * Polaris Track A: theme default applied when localStorage is empty.
   * Customer surface defaults to "light" (consumer-friendly, better outdoor
   * visibility); admin keeps "dark". When omitted we derive from `role`.
   */
  defaultTheme?: "dark" | "light";
}

export function SidebarLayout({
  children,
  currentPath,
  actions,
  accentColor,
  user,
  navSections = ADMIN_NAV_SECTIONS,
  role = "admin",
  defaultTheme,
}: SidebarLayoutProps) {
  const resolvedDefaultTheme = defaultTheme ??
    (role === "customer" ? "light" : "dark");
  const storageKey = role === "customer" ? "polaris-theme" : "ev-billing-theme";

  return (
    <ThemeProvider
      defaultTheme={resolvedDefaultTheme}
      storageKey={storageKey}
    >
      <SidebarWrapper
        currentPath={currentPath}
        actions={actions}
        accentColor={accentColor}
        user={user}
        navSections={navSections}
        role={role}
      >
        {children}
      </SidebarWrapper>
    </ThemeProvider>
  );
}

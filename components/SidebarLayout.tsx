import type { ComponentChildren } from "preact";
import SidebarWrapper from "@/islands/SidebarWrapper.tsx";
import { ThemeProvider } from "@/hooks/use-theme.tsx";

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
   * Polaris Track A: which UI surface this layout serves. Drives brand
   * selection (ExpresSync vs Polaris Express), mobile shell pattern,
   * the localStorage key used by the theme provider, AND which nav
   * module the sidebar renders. The nav data is looked up inside the
   * SidebarWrapper island so its function-typed icons never have to be
   * crossed through Fresh's prop serializer. Defaults to "admin".
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
        role={role}
      >
        {children}
      </SidebarWrapper>
    </ThemeProvider>
  );
}

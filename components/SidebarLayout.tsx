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
}

interface SidebarLayoutProps {
  children: ComponentChildren;
  currentPath: string;
  title?: string; // Kept for backwards compatibility but no longer displayed in top bar
  description?: string; // Kept for backwards compatibility but no longer displayed in top bar
  actions?: ComponentChildren;
  accentColor?: import("@/src/lib/colors.ts").AccentColor;
  user?: User;
}

export function SidebarLayout({
  children,
  currentPath,
  actions,
  accentColor,
  user,
}: SidebarLayoutProps) {
  return (
    <ThemeProvider defaultTheme="dark">
      <SidebarWrapper
        currentPath={currentPath}
        actions={actions}
        accentColor={accentColor}
        user={user}
      >
        {children}
      </SidebarWrapper>
    </ThemeProvider>
  );
}

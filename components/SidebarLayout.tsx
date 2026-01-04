import type { ComponentChildren } from "preact";
import SidebarWrapper from "@/islands/SidebarWrapper.tsx";
import { ThemeProvider } from "@/hooks/use-theme.tsx";

interface User {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
}

interface SidebarLayoutProps {
  children: ComponentChildren;
  currentPath: string;
  title?: string;
  description?: string;
  actions?: ComponentChildren;
  user?: User;
}

export function SidebarLayout({
  children,
  currentPath,
  title,
  description,
  actions,
  user,
}: SidebarLayoutProps) {
  return (
    <ThemeProvider defaultTheme="dark">
      <SidebarWrapper
        currentPath={currentPath}
        title={title}
        description={description}
        actions={actions}
        user={user}
      >
        {children}
      </SidebarWrapper>
    </ThemeProvider>
  );
}

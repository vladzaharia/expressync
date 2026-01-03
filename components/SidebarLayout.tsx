import type { ComponentChildren } from "preact";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "./ui/sidebar.tsx";
import { AppSidebar } from "./AppSidebar.tsx";
import { Separator } from "./ui/separator.tsx";
import { ThemeProvider } from "@/hooks/use-theme.tsx";

interface SidebarLayoutProps {
  children: ComponentChildren;
  currentPath: string;
  title?: string;
  description?: string;
  actions?: ComponentChildren;
}

export function SidebarLayout({
  children,
  currentPath,
  title,
  description,
  actions,
}: SidebarLayoutProps) {
  return (
    <ThemeProvider defaultTheme="dark">
      <SidebarProvider>
        <AppSidebar currentPath={currentPath} />
        <SidebarInset>
          <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
            <div className="flex flex-1 items-center justify-between">
              {title && (
                <div className="flex flex-col">
                  <h1 className="text-lg font-semibold">{title}</h1>
                  {description && (
                    <p className="text-sm text-muted-foreground">{description}</p>
                  )}
                </div>
              )}
              {actions && <div className="flex items-center gap-2">{actions}</div>}
            </div>
          </header>
          <main className="flex-1 overflow-auto p-4 md:p-6">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </ThemeProvider>
  );
}


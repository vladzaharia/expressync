import type { ComponentChildren } from "preact";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar.tsx";
import { AppSidebar } from "@/components/AppSidebar.tsx";
import { Separator } from "@/components/ui/separator.tsx";

interface User {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
}

interface SidebarWrapperProps {
  children: ComponentChildren;
  currentPath: string;
  title?: string;
  description?: string;
  actions?: ComponentChildren;
  user?: User;
}

export default function SidebarWrapper({
  children,
  currentPath,
  title,
  description,
  actions,
  user,
}: SidebarWrapperProps) {
  return (
    <SidebarProvider>
      <AppSidebar currentPath={currentPath} user={user} />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <div className="flex flex-1 items-center justify-between">
            {title && (
              <div className="flex flex-col">
                <h1 className="text-lg font-semibold">{title}</h1>
                {description && (
                  <p className="text-sm text-muted-foreground">
                    {description}
                  </p>
                )}
              </div>
            )}
            {actions && <div className="flex items-center gap-2">{actions}
            </div>}
          </div>
        </header>
        <main className="flex-1 overflow-auto p-4 md:p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}

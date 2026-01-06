import type { ComponentChildren } from "preact";
import {
  SidebarInset,
  SidebarProvider,
  useSidebar,
} from "@/components/ui/sidebar.tsx";
import { AppSidebar, CHROME_SIZE } from "@/components/AppSidebar.tsx";
import { PanelLeft } from "lucide-preact";
import { cn } from "@/src/lib/utils/cn.ts";
import { type AccentColor, accentTailwindClasses } from "@/src/lib/colors.ts";

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
  accentColor?: AccentColor;
  user?: User;
}

function TopBarContent({
  actions,
  accentColor = "blue",
}: Pick<SidebarWrapperProps, "actions" | "accentColor">) {
  const { toggleSidebar } = useSidebar();

  // Get accent color classes from centralized config
  const colorClasses = accentTailwindClasses[accentColor];
  const accentBgClass =
    `${colorClasses.bg} ${colorClasses.bgHover} ${colorClasses.text}`;

  return (
    <header
      className="flex shrink-0 items-stretch border-b bg-background sticky top-0 z-10"
      style={{ height: CHROME_SIZE }}
    >
      {/* Spacer */}
      <div className="flex-1" />

      {/* Page action section - full block with accent background */}
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
    </header>
  );
}

export default function SidebarWrapper({
  children,
  currentPath,
  actions,
  accentColor,
  user,
}: SidebarWrapperProps) {
  return (
    <SidebarProvider defaultOpen={false}>
      <AppSidebar currentPath={currentPath} user={user} />
      <SidebarInset>
        <TopBarContent actions={actions} accentColor={accentColor} />
        <main className="flex-1 overflow-auto p-4 md:p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "./ui/sidebar.tsx";
import ThemeToggle from "../islands/ThemeToggle.tsx";
import {
  LayoutDashboard,
  Link2,
  Receipt,
  RefreshCw,
  LogOut,
  Zap,
} from "lucide-preact";

interface AppSidebarProps {
  currentPath: string;
}

const mainNavItems = [
  {
    title: "Dashboard",
    url: "/",
    icon: LayoutDashboard,
  },
  {
    title: "Mappings",
    url: "/mappings",
    icon: Link2,
  },
  {
    title: "Transactions",
    url: "/transactions",
    icon: Receipt,
  },
  {
    title: "Sync",
    url: "/sync",
    icon: RefreshCw,
  },
];

export function AppSidebar({ currentPath }: AppSidebarProps) {
  const isActive = (url: string) => {
    if (url === "/") return currentPath === "/";
    return currentPath.startsWith(url);
  };

  return (
    <Sidebar>
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-2 px-2 py-3">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Zap className="size-4" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold">EV Billing</span>
            <span className="text-xs text-muted-foreground">OCPP Portal</span>
          </div>
        </div>
      </SidebarHeader>
      
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainNavItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive(item.url)}
                    tooltip={item.title}
                  >
                    <a href={item.url}>
                      <item.icon />
                      <span>{item.title}</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      
      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="flex items-center justify-between px-2 py-1">
              <span className="text-sm text-muted-foreground">Theme</span>
              <ThemeToggle />
            </div>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Sign Out">
              <a href="/api/auth/logout">
                <LogOut />
                <span>Sign Out</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}


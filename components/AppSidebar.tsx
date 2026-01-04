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
import { AuroraText } from "./magicui/aurora-text.tsx";
import {
  LayoutDashboard,
  Link2,
  LogOut,
  Receipt,
  RefreshCw,
  User,
  Zap,
} from "lucide-preact";
import { Separator } from "./ui/separator.tsx";

interface UserInfo {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
}

interface AppSidebarProps {
  currentPath: string;
  user?: UserInfo;
}

const mainNavItems = [
  {
    title: "Dashboard",
    url: "/",
    icon: LayoutDashboard,
  },
  {
    title: "Tag Linking",
    url: "/tag-linking",
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

export function AppSidebar({ currentPath, user }: AppSidebarProps) {
  const isActive = (url: string) => {
    if (url === "/") return currentPath === "/";
    return currentPath.startsWith(url);
  };

  const handleSignOut = async () => {
    await fetch("/api/auth/sign-out", { method: "POST" });
    window.location.href = "/login";
  };

  return (
    <Sidebar>
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-3 px-2 py-3">
          <div className="relative flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-md">
            <Zap className="size-5" />
            <div className="absolute inset-0 rounded-xl animate-pulse-glow opacity-50" />
          </div>
          <div className="flex flex-col">
            <AuroraText className="text-sm font-bold">
              EV Billing
            </AuroraText>
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
        </SidebarMenu>

        {user && (
          <>
            <Separator className="my-2" />
            <div className="px-2 py-2">
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-full bg-primary/10">
                  <User className="size-4 text-primary" />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-medium truncate">
                    {user.name || "User"}
                  </span>
                  <span className="text-xs text-muted-foreground truncate">
                    {user.email}
                  </span>
                </div>
              </div>
            </div>
          </>
        )}

        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Sign Out"
              onClick={handleSignOut}
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              <LogOut />
              <span>Sign Out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

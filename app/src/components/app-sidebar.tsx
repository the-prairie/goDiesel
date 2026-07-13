import {
  Compass,
  Database,
  Globe2,
  Map,
  Route,
  Search,
  Settings,
  X,
} from "lucide-react";
import { Link, NavLink, useLocation } from "react-router-dom";

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
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { completedRoutes, routes } from "@/data/routes";

const navItems = [
  { path: "/atlas", label: "Atlas", icon: Globe2 },
  { path: "/finder", label: "Finder", icon: Search },
  { path: "/routes", label: "Routes", icon: Route },
  { path: "/replay", label: "Replay", icon: Compass },
  { path: "/admin", label: "Admin", icon: Settings },
];

export function AppSidebar() {
  const totalKm = completedRoutes.reduce((sum, route) => sum + route.distanceKm, 0);
  const { isMobile, setOpenMobile } = useSidebar();
  const location = useLocation();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border p-3">
        <div className="flex items-center gap-2">
          <SidebarMenu className="min-w-0 flex-1">
            <SidebarMenuItem>
              <SidebarMenuButton asChild size="lg" tooltip="goDiesel Atlas">
                <Link to="/atlas" onClick={() => setOpenMobile(false)}>
                  <span className="size-3 shrink-0 rounded-full bg-primary shadow-[0_0_18px_hsl(var(--primary))]" />
                  <span className="grid min-w-0 flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
                    <span className="truncate text-base font-bold">godiesel</span>
                    <span className="truncate text-xs text-muted-foreground">
                      Quest atlas
                    </span>
                  </span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          {isMobile ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Close navigation"
              onClick={() => setOpenMobile(false)}
            >
              <X aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Explore</SidebarGroupLabel>
          <SidebarGroupContent>
            <nav aria-label="Primary">
              <SidebarMenu>
                {navItems.map((item) => {
                  const Icon = item.icon;

                  return (
                    <SidebarMenuItem key={item.path}>
                      <SidebarMenuButton
                        asChild
                        isActive={
                          location.pathname === item.path ||
                          ((item.path === "/routes" || item.path === "/replay") &&
                            location.pathname.startsWith(`${item.path}/`))
                        }
                        tooltip={item.label}
                        className="min-h-10"
                      >
                        <NavLink
                          to={item.path}
                          end={item.path !== "/routes" && item.path !== "/replay"}
                          onClick={() => setOpenMobile(false)}
                        >
                          <Icon aria-hidden="true" />
                          <span>{item.label}</span>
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </nav>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-3">
        <div className="grid gap-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
          <div className="flex items-center gap-2 text-foreground">
            <Database className="size-4" aria-hidden="true" />
            <span>{routes.length} route records</span>
          </div>
          <div className="flex items-center gap-2">
            <Map className="size-4" aria-hidden="true" />
            <span>{totalKm.toFixed(0)} completed km</span>
          </div>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

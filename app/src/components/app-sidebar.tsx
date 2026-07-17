import { Database, Map, X } from "lucide-react";
import { Link, useLocation } from "react-router-dom";

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
import routeStats from "@/data/generated/route-stats.json";
import { APP_PATHS, APP_SECTIONS, appSectionForPath } from "@/navigation";

export function AppSidebar() {
  const { isMobile, setOpenMobile } = useSidebar();
  const location = useLocation();
  const activeSection = appSectionForPath(location.pathname);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border p-3">
        <div className="flex items-center gap-2">
          <SidebarMenu className="min-w-0 flex-1">
            <SidebarMenuItem>
              <SidebarMenuButton asChild size="lg" tooltip="goDiesel Atlas">
                <Link to={APP_PATHS.atlas} onClick={() => setOpenMobile(false)}>
                  <span className="size-3 shrink-0 rounded-full bg-primary shadow-[0_0_18px_var(--primary)]" />
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
                {APP_SECTIONS.map((section) => {
                  const Icon = section.icon;

                  return (
                    <SidebarMenuItem key={section.path}>
                      <SidebarMenuButton
                        asChild
                        isActive={activeSection.id === section.id}
                        tooltip={section.label}
                        className="min-h-10"
                      >
                        <Link
                          to={section.path}
                          aria-current={activeSection.id === section.id ? "page" : undefined}
                          onClick={() => setOpenMobile(false)}
                        >
                          <Icon aria-hidden="true" />
                          <span>{section.label}</span>
                        </Link>
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
            <span>{routeStats.route_count} route records</span>
          </div>
          <div className="flex items-center gap-2">
            <Map className="size-4" aria-hidden="true" />
            <span>{routeStats.completed_km.toFixed(0)} completed km</span>
          </div>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

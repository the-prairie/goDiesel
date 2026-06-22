import {
  Compass,
  Database,
  Globe2,
  Map,
  Route,
  Search,
  Settings,
} from "lucide-react";

import {
  Sidebar,
  SidebarButton,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@/components/ui/sidebar";
import type { AppView } from "@/components/app-shell";
import { completedRoutes, routes } from "@/data/routes";

const navItems: Array<{
  id: AppView;
  label: string;
  icon: typeof Globe2;
}> = [
  { id: "atlas", label: "Atlas", icon: Globe2 },
  { id: "finder", label: "Finder", icon: Search },
  { id: "routes", label: "Routes", icon: Route },
  { id: "replay", label: "Replay", icon: Compass },
  { id: "admin", label: "Admin", icon: Settings },
];

interface AppSidebarProps {
  activeView: AppView;
  onNavigate: (view: AppView) => void;
}

export function AppSidebar({ activeView, onNavigate }: AppSidebarProps) {
  const totalKm = completedRoutes.reduce((sum, route) => sum + route.distanceKm, 0);

  return (
    <Sidebar className="hidden md:flex">
      <SidebarHeader>
        <div className="flex items-center gap-3">
          <div className="size-3 rounded-full bg-primary shadow-[0_0_22px_hsl(var(--primary))]" />
          <div>
            <div className="text-lg font-bold text-foreground">godiesel</div>
            <div className="text-xs text-muted-foreground">Quest atlas</div>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <SidebarButton
              key={item.id}
              active={item.id === activeView}
              onClick={() => onNavigate(item.id)}
            >
              <Icon className="size-4" aria-hidden="true" />
              <span>{item.label}</span>
            </SidebarButton>
          );
        })}
      </SidebarContent>
      <SidebarFooter>
        <div className="grid gap-3 rounded-md border border-border bg-card p-3 text-xs text-muted-foreground">
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
    </Sidebar>
  );
}

export function MobileNav({
  activeView,
  onNavigate,
}: AppSidebarProps) {
  return (
    <nav
      className="fixed inset-x-3 bottom-3 z-20 grid grid-cols-5 rounded-md border border-border bg-sidebar/95 p-1 shadow-2xl backdrop-blur md:hidden"
      aria-label="Primary"
    >
      {navItems.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onNavigate(item.id)}
            className="flex min-h-12 flex-col items-center justify-center gap-1 rounded-sm text-[11px] font-medium text-muted-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring data-[active=true]:bg-sidebar-primary data-[active=true]:text-sidebar-primary-foreground"
            data-active={item.id === activeView ? "true" : "false"}
          >
            <Icon className="size-4" aria-hidden="true" />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

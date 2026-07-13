import { Menu } from "lucide-react";
import { Outlet, useLocation } from "react-router-dom";

import { AppSidebar } from "@/components/app-sidebar";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

const sectionLabels: Record<string, string> = {
  atlas: "Atlas",
  finder: "Finder",
  routes: "Routes",
  replay: "Replay",
  admin: "Admin",
};

export function AppShell() {
  const location = useLocation();
  const section = location.pathname.split("/").filter(Boolean)[0] ?? "atlas";

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="min-w-0 bg-background text-foreground">
        <header className="sticky top-0 z-30 flex min-h-14 items-center gap-3 border-b border-border bg-background/92 px-4 backdrop-blur md:px-5">
          <SidebarTrigger
            aria-label="Open navigation"
            className="size-9 border border-border"
          >
            <Menu className="size-4" aria-hidden="true" />
          </SidebarTrigger>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">
              {sectionLabels[section] ?? "Atlas"}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              Relive where you have been. Discover where to go next.
            </div>
          </div>
        </header>
        <div className="mx-auto grid w-full max-w-7xl flex-1 gap-6 p-4 sm:p-6">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

import { Menu } from "lucide-react";
import { Suspense } from "react";
import { Outlet, useLocation } from "react-router-dom";

import { AppSidebar } from "@/components/app-sidebar";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { appSectionForPath } from "@/navigation";
import { cn } from "@/lib/utils";

export function AppShell() {
  const location = useLocation();
  const section = appSectionForPath(location.pathname);
  const isAtlas = section.id === "atlas";
  const isPlayableEarthLab = location.pathname.startsWith("/lab/playable-earth/");
  const isImmersive = isAtlas || isPlayableEarthLab;

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
              {section.label}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              Relive where you have been. Discover where to go next.
            </div>
          </div>
        </header>
        <div
          className={cn(
            "grid w-full flex-1",
            isImmersive
              ? "min-h-[calc(100dvh-3.5rem)] overflow-hidden"
              : "mx-auto max-w-7xl gap-6 p-4 sm:p-6",
          )}
        >
          <Suspense
            fallback={
              <div
                role="status"
                aria-live="polite"
                className="rounded-md border border-border bg-card p-5 text-sm text-muted-foreground"
              >
                Loading view.
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

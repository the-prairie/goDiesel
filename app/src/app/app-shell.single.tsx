import { Suspense } from "react";
import { Outlet } from "react-router-dom";

import { SurfacePlaceholder } from "@/app/surface-placeholder";

// The shell of a single-route microsite (ADR-0011). vite.config.ts aliases
// `@/app/app-shell` to this module when VITE_SINGLE_ROUTE_SLUG is set. It has
// no product navigation, so the Atlas spine and its atlas-wide totals never
// reach a share bundle. Every microsite view is immersive, and with no mobile
// navigation its views and placeholders use the full height.
export function AppShell() {
  return (
    <div className="weathered-atlas field-guide-theme relative flex min-h-dvh bg-background text-foreground [--mobile-navigation-height:0px]">
      <div className="flex min-h-dvh min-w-0 flex-1 flex-col">
        <main className="min-h-0 w-full flex-1 overflow-hidden">
          <Suspense fallback={<SurfacePlaceholder surface="route" />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}

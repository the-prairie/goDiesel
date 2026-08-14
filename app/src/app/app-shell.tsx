import { Suspense, useRef } from "react";
import { Outlet, useLocation } from "react-router-dom";

import { AtlasSpine } from "@/surfaces/atlas/components/atlas-spine";
import { AtlasImmersiveNavigation } from "@/surfaces/atlas/components/atlas-immersive-navigation";
import { singleRouteMicrosite } from "@/app/single-route-microsite";
import { APP_PATHS } from "@/app/route-paths";
import { appSectionForPath } from "@/app/app-sections";
import { useNavigationContinuity } from "@/app/navigation-continuity";
import { cn } from "@/ui/utils";

export function AppShell() {
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  useNavigationContinuity(mainRef);
  const section = appSectionForPath(location.pathname);
  const isAtlas = location.pathname === APP_PATHS.atlas;
  const isReplayLab = location.pathname.startsWith("/lab/");
  const isRouteDetail = /^\/routes\/[^/]+$/.test(location.pathname);
  const isRoutesLibrary = section.id === "routes" && !isRouteDetail;
  const isReplay = section.id === "replay";
  const isWideUtility = isRoutesLibrary || section.id === "admin";
  const isImmersive =
    isAtlas ||
    isReplayLab ||
    isRouteDetail ||
    section.id === "finder" ||
    section.id === "replay";
  const isUtility =
    isRoutesLibrary || section.id === "admin";

  return (
    <div className="weathered-atlas field-guide-theme relative flex min-h-dvh bg-background text-foreground">
      {singleRouteMicrosite || isReplay ? null : (
        <AtlasSpine hideDesktop={isAtlas || isRouteDetail} />
      )}
      {isAtlas && !singleRouteMicrosite ? <AtlasImmersiveNavigation /> : null}
      <div
        className={cn(
          "flex min-h-dvh min-w-0 flex-1 flex-col",
          !singleRouteMicrosite &&
            !isReplay &&
            "pb-[var(--mobile-navigation-height)] md:pb-0",
            !singleRouteMicrosite &&
            !isAtlas &&
            !isRouteDetail &&
            !isReplay &&
            "md:pl-[var(--spine-rail-width)] lg:pl-[var(--spine-width)]",
        )}
      >
        {isUtility ? (
          <header
            data-testid="app-header"
            className="sticky top-0 z-[var(--z-map-controls)] flex h-14 items-center gap-3 border-b border-line bg-surface/94 px-4 backdrop-blur sm:px-6"
          >
            <div className="min-w-0 flex-1">
              <div
                data-testid="app-page-title"
                className="truncate text-control font-semibold text-ink"
              >
                {section.label}
              </div>
              <div
                data-testid="global-product-subtitle"
                className="hidden truncate text-caption text-ink-muted sm:block"
              >
                Relive where you have been. Discover where to go next.
              </div>
            </div>
          </header>
        ) : null}
        <main
          ref={mainRef}
          tabIndex={-1}
          className={cn(
            "w-full flex-1 focus:outline-none",
            isImmersive
              ? "min-h-0 overflow-hidden"
              : isWideUtility
                ? "grid gap-6 p-4 sm:p-6"
                : "mx-auto grid max-w-7xl gap-6 p-4 sm:p-6",
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
        </main>
      </div>
    </div>
  );
}

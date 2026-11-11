import { Suspense, useEffect } from "react";
import { Outlet, useLocation, useMatches } from "react-router-dom";

import { AtlasSpine } from "@/surfaces/atlas/components/atlas-spine";
import { singleRouteMicrosite } from "@/app/single-route-microsite";
import { APP_PATHS } from "@/app/route-paths";
import { appSectionForPath } from "@/app/app-sections";
import {
  SurfacePlaceholder,
  surfaceDocumentTitle,
  surfaceOfHandle,
} from "@/app/surface-placeholder";
import { cn } from "@/ui/utils";

export function AppShell() {
  const location = useLocation();
  const section = appSectionForPath(location.pathname);
  const isAtlas = location.pathname === APP_PATHS.atlas;
  const isReplayLab = location.pathname.startsWith("/lab/");
  const isRouteDetail = /^\/routes\/[^/]+$/.test(location.pathname);
  const isCoursePreview = /^\/courses\/[^/]+\/preview$/.test(location.pathname);
  const isRoutesLibrary = section?.id === "routes" && !isRouteDetail;
  const isWideUtility = isRoutesLibrary || section?.id === "admin";
  const isImmersive =
    isAtlas ||
    isReplayLab ||
    isRouteDetail ||
    isCoursePreview ||
    section?.id === "finder" ||
    section?.id === "replay";
  const isUtility = section?.id === "admin";
  const surface = surfaceOfHandle(useMatches().at(-1)?.handle);

  // The tab names the surface, so history and tab lists are legible.
  useEffect(() => {
    document.title = surfaceDocumentTitle(surface);
  }, [surface]);

  return (
    <div className="weathered-atlas field-guide-theme relative flex min-h-dvh bg-background text-foreground">
      {singleRouteMicrosite ? null : <AtlasSpine />}
      <div
        className={cn(
          "flex min-h-dvh min-w-0 flex-1 flex-col",
          !singleRouteMicrosite &&
            "pb-[var(--mobile-navigation-height)] md:pb-0",
          !singleRouteMicrosite &&
            "md:pl-[var(--spine-rail-width)] lg:pl-[var(--spine-width)]",
        )}
      >
        {isUtility ? (
          <header
            data-testid="app-header"
            className="sticky top-0 z-[var(--z-map-controls)] flex h-[calc(3.5rem+var(--safe-area-top))] items-center gap-3 border-b border-line bg-surface/94 px-4 pt-[var(--safe-area-top)] backdrop-blur sm:px-6"
          >
            <div className="min-w-0 flex-1">
              <div
                data-testid="app-page-title"
                className="truncate text-control font-semibold text-ink"
              >
                {section?.label}
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
          className={cn(
            "w-full flex-1",
            isImmersive
              ? "min-h-0 overflow-hidden"
              : isWideUtility
                ? "mx-auto grid max-w-[90rem] gap-6 p-4 sm:p-8 lg:p-10"
                : "mx-auto grid max-w-7xl gap-6 p-4 sm:p-6",
            // The content area adds the safe-area insets of the edges it
            // touches: the top unless the utility header covers it, the right
            // always, and the left below md, where no rail accounts for it.
            !isImmersive &&
              !isUtility &&
              (isWideUtility
                ? "pt-[calc(1rem+var(--safe-area-top))] sm:pt-[calc(2rem+var(--safe-area-top))] lg:pt-[calc(2.5rem+var(--safe-area-top))]"
                : "pt-[calc(1rem+var(--safe-area-top))] sm:pt-[calc(1.5rem+var(--safe-area-top))]"),
            !isImmersive &&
              (isWideUtility
                ? "pr-[calc(1rem+var(--safe-area-right))] pl-[calc(1rem+var(--safe-area-left))] sm:pr-[calc(2rem+var(--safe-area-right))] sm:pl-[calc(2rem+var(--safe-area-left))] md:pl-8 lg:pr-[calc(2.5rem+var(--safe-area-right))] lg:pl-10"
                : "pr-[calc(1rem+var(--safe-area-right))] pl-[calc(1rem+var(--safe-area-left))] sm:pr-[calc(1.5rem+var(--safe-area-right))] sm:pl-[calc(1.5rem+var(--safe-area-left))] md:pl-6"),
          )}
        >
          <Suspense fallback={<SurfacePlaceholder surface={surface ?? "missing"} />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}

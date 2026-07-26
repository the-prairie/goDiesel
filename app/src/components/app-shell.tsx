import { Suspense } from "react";
import { Outlet, useLocation } from "react-router-dom";

import { AtlasSpine } from "@/components/atlas-spine";
import { appSectionForPath } from "@/navigation";
import { cn } from "@/lib/utils";

export function AppShell() {
  const location = useLocation();
  const section = appSectionForPath(location.pathname);
  const isAtlas = section.id === "atlas";
  const isReplayLab = location.pathname.startsWith("/lab/");
  const isImmersive = isAtlas || isReplayLab || section.id === "replay";
  const isUtility = section.id === "routes" || section.id === "admin" || section.id === "finder";

  return (
    <div
      className="weathered-atlas field-guide-theme relative flex min-h-dvh w-full bg-canvas text-ink"
      data-surface={isImmersive ? "immersive" : "utility"}
    >
      <AtlasSpine />

      <div
        className={cn(
          "flex min-h-dvh min-w-0 flex-1 flex-col",
          "md:pl-[var(--spine-rail-width)] lg:pl-[var(--spine-width)]",
          "pb-[var(--mobile-navigation-height)] md:pb-0",
        )}
      >
        {isUtility ? (
          <header
            data-testid="app-header"
            className="sticky top-0 z-[var(--z-map-controls)] flex h-14 items-center gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur-sm sm:px-5"
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
          className={cn(
            "grid w-full flex-1 leaf-turn-enter",
            isImmersive
              ? "min-h-0 overflow-hidden"
              : "mx-auto max-w-7xl content-start gap-8 p-4 sm:p-6 lg:p-8",
          )}
        >
          <Suspense
            fallback={
              <div
                role="status"
                aria-live="polite"
                className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 text-control text-ink-muted"
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

import { ChevronLeft, Menu, Search } from "lucide-react";
import { useRef } from "react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { RouteRegion } from "@/data/route-regions";
import routeStats from "@/data/generated/route-stats.json";
import { cn } from "@/lib/utils";
import { APP_PATHS, APP_SECTIONS } from "@/navigation";

interface AtlasImmersiveNavigationProps {
  selectedRegion?: RouteRegion;
  onReturnToWorld: () => void;
  onOpenSearch: () => void;
}

export function AtlasImmersiveNavigation({
  selectedRegion,
  onReturnToWorld,
  onOpenSearch,
}: AtlasImmersiveNavigationProps) {
  const firstDestinationRef = useRef<HTMLAnchorElement>(null);

  return (
    <header
      data-testid="atlas-compact-navigation"
      className="pointer-events-none absolute inset-x-0 top-0 z-[var(--z-navigation)] h-[4.5rem] border-b border-white/15 bg-[#02070a]/78 text-white backdrop-blur-md"
    >
      <div className="grid h-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center px-3 sm:px-5">
        <div className="pointer-events-auto flex min-w-0 items-center">
          {selectedRegion ? (
            <Button
              type="button"
              variant="ghost"
              onClick={onReturnToWorld}
              className="h-11 gap-2 rounded-sm px-2 text-white hover:bg-white/10 hover:text-white sm:px-3"
            >
              <ChevronLeft aria-hidden="true" />
              <span>World</span>
            </Button>
          ) : (
            <Link
              to={APP_PATHS.atlas}
              aria-label="Return to global Atlas"
              className="flex h-11 items-center gap-2.5 px-1 outline-none focus-visible:ring-2 focus-visible:ring-[#8de8d2]"
            >
              <span className="atlas-spine-mark shrink-0" aria-hidden="true" />
              <span className="font-editorial text-xl font-semibold">goDiesel</span>
            </Link>
          )}

          <Sheet>
            <SheetTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Open application navigation"
                title="Open navigation"
                className="ml-1 size-11 rounded-sm text-white/78 hover:bg-white/10 hover:text-white focus-visible:ring-[#8de8d2]"
              >
                <Menu aria-hidden="true" />
              </Button>
            </SheetTrigger>
            <SheetContent
              side="left"
              aria-label="goDiesel navigation"
              onOpenAutoFocus={(event) => {
                event.preventDefault();
                firstDestinationRef.current?.focus();
              }}
              className="w-[19rem] max-w-[calc(100vw-2rem)] gap-0 border-line bg-surface-raised p-0 text-ink sm:max-w-[19rem]"
            >
              <SheetHeader className="border-b border-line px-5 py-5 text-left">
                <SheetTitle className="font-editorial text-2xl font-semibold">
                  goDiesel
                </SheetTitle>
                <SheetDescription>
                  Memories, routes, and the tools for planning what comes next.
                </SheetDescription>
              </SheetHeader>
              <nav aria-label="Application" className="grid gap-1 p-3">
                {APP_SECTIONS.map((section) => {
                  const Icon = section.icon;
                  return (
                    <SheetClose key={section.path} asChild>
                      <Link
                        ref={
                          section.id === "atlas"
                            ? firstDestinationRef
                            : undefined
                        }
                        to={section.path}
                        aria-current={
                          section.id === "atlas" ? "page" : undefined
                        }
                        className={cn(
                          "flex min-h-12 items-center gap-3 rounded-[var(--radius-control)] px-3 text-control outline-none transition-colors",
                          "focus-visible:ring-2 focus-visible:ring-ring",
                          section.id === "atlas"
                            ? "bg-forest-soft text-forest"
                            : "text-ink-secondary hover:bg-surface-muted hover:text-ink",
                        )}
                      >
                        <Icon className="size-4" aria-hidden="true" />
                        <span>{section.label}</span>
                      </Link>
                    </SheetClose>
                  );
                })}
              </nav>
              <SheetFooter className="border-t border-line text-caption text-ink-muted">
                <p className="tabular-nums text-ink-secondary">
                  {routeStats.route_count} journeys
                </p>
                <p className="tabular-nums">
                  {routeStats.completed_km.toFixed(0)} km remembered
                </p>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        </div>

        <div className="min-w-0 text-center">
          {selectedRegion ? (
            <>
              <h1 className="truncate font-editorial text-lg font-semibold sm:text-2xl">
                {selectedRegion.name}
              </h1>
              <p className="hidden truncate text-xs tabular-nums text-white/62 sm:block">
                {selectedRegion.routes.length} journeys ·{" "}
                {selectedRegion.totalKm.toFixed(0)} km ·{" "}
                {Math.round(selectedRegion.totalClimbM).toLocaleString()} m up
              </p>
            </>
          ) : (
            <nav
              aria-label="Atlas mode"
              data-testid="atlas-mode-navigation"
              className="pointer-events-auto inline-flex h-11 items-center border border-white/20 bg-black/15 p-0.5"
            >
              <Link
                to={APP_PATHS.atlas}
                aria-current="page"
                className="inline-flex h-10 items-center border-b border-white px-4 text-sm font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#8de8d2]"
              >
                Memories
              </Link>
              <Link
                to={APP_PATHS.finder}
                className="inline-flex h-10 items-center px-4 text-sm text-white/62 outline-none hover:text-white focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#8de8d2]"
              >
                Plan
              </Link>
            </nav>
          )}
        </div>

        <div className="pointer-events-auto flex justify-end">
          {selectedRegion ? (
            <nav
              aria-label="Atlas mode"
              data-testid="atlas-mode-navigation"
              className="mr-1 hidden h-11 items-center border-r border-white/18 sm:flex"
            >
              <Link
                to={APP_PATHS.atlas}
                aria-current="page"
                className="inline-flex h-10 items-center border-b border-white px-3 text-sm font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#8de8d2]"
              >
                Memories
              </Link>
              <Link
                to={APP_PATHS.finder}
                className="inline-flex h-10 items-center px-3 text-sm text-white/62 outline-none hover:text-white focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#8de8d2]"
              >
                Plan
              </Link>
            </nav>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Search the Atlas"
            title="Search"
            onClick={onOpenSearch}
            className="size-11 rounded-sm text-white hover:bg-white/10 hover:text-white focus-visible:ring-[#8de8d2]"
          >
            <Search aria-hidden="true" />
          </Button>
        </div>
      </div>
    </header>
  );
}

import { Menu } from "lucide-react";
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
import routeStats from "@/data/generated/route-stats.json";
import { cn } from "@/lib/utils";
import { APP_PATHS } from "@/app/route-paths";
import { APP_SECTIONS } from "@/app/app-sections";

export function AtlasImmersiveNavigation() {
  const firstDestinationRef = useRef<HTMLAnchorElement>(null);

  return (
    <>
      <header
        data-testid="atlas-compact-navigation"
        className="fixed left-5 top-5 z-[var(--z-navigation)] hidden h-[54px] items-center border border-white/40 bg-[#07151c]/94 text-white shadow-lg backdrop-blur-md md:flex"
      >
        <Link
          to={APP_PATHS.atlas}
          aria-label="Return to global Atlas"
          className="flex h-full items-center gap-2.5 px-3 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#63d6cf]"
        >
          <span className="atlas-spine-mark shrink-0" aria-hidden="true" />
          <span className="font-editorial text-lg font-semibold">goDiesel</span>
        </Link>

        <Sheet>
          <SheetTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Open application navigation"
              title="Open navigation"
              className="mr-1 size-11 border-l border-white/20 text-white hover:bg-white/12 hover:text-white focus-visible:ring-[#63d6cf]"
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
                goDiesel navigation
              </SheetTitle>
              <SheetDescription>
                Completed memories and the tools for planning what comes next.
              </SheetDescription>
            </SheetHeader>
            <nav aria-label="Application" className="grid gap-1 p-3">
              {APP_SECTIONS.map((section) => {
                const Icon = section.icon;
                return (
                  <SheetClose key={section.path} asChild>
                    <Link
                      ref={section.id === "atlas" ? firstDestinationRef : undefined}
                      to={section.path}
                      aria-current={section.id === "atlas" ? "page" : undefined}
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
                {routeStats.route_count} routes
              </p>
              <p className="tabular-nums">
                {routeStats.completed_km.toFixed(0)} km inked
              </p>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </header>

      <nav
        aria-label="Atlas mode"
        data-testid="atlas-mode-navigation"
        className="fixed right-5 top-5 z-[var(--z-navigation)] hidden h-[54px] items-center border border-white/40 bg-[#07151c]/94 p-1 text-white shadow-lg backdrop-blur-md md:flex"
      >
        <Link
          to={APP_PATHS.atlas}
          aria-current="page"
          className="inline-flex h-11 items-center bg-white px-4 text-sm font-semibold text-[#15221e] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#63d6cf]"
        >
          Memories
        </Link>
        <Link
          to={APP_PATHS.finder}
          className="inline-flex h-11 items-center px-4 text-sm text-white/78 outline-none hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#63d6cf]"
        >
          Plan
        </Link>
      </nav>
    </>
  );
}

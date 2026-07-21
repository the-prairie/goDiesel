import { Link, useLocation } from "react-router-dom";

import routeStats from "@/data/generated/route-stats.json";
import { cn } from "@/lib/utils";
import { APP_PATHS, APP_SECTIONS, appSectionForPath } from "@/navigation";

interface AtlasSpineProps {
  className?: string;
  hideDesktop?: boolean;
}

export function AtlasSpine({ className, hideDesktop = false }: AtlasSpineProps) {
  const location = useLocation();
  const activeSection = appSectionForPath(location.pathname);

  return (
    <>
      {!hideDesktop ? <aside
        data-testid="atlas-spine"
        data-slot="sidebar-container"
        className={cn(
          "atlas-spine fixed inset-y-0 left-0 z-[var(--z-navigation)] hidden w-[var(--spine-width)] flex-col md:flex",
          "md:w-[var(--spine-rail-width)] lg:w-[var(--spine-width)]",
          className,
        )}
      >
        <div className="flex items-center gap-3 border-b border-line px-3 py-4 lg:px-4">
          <Link
            to={APP_PATHS.atlas}
            className="group flex min-w-0 items-center gap-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="atlas-spine-mark shrink-0" aria-hidden="true" />
            <span className="hidden min-w-0 flex-1 lg:grid">
              <span className="font-editorial truncate text-lg font-medium tracking-[0.01em] text-ink">
                goDiesel
              </span>
              <span className="truncate text-caption text-ink-muted">
                Weathered atlas
              </span>
            </span>
          </Link>
        </div>

        <nav
          aria-label="Primary"
          className="relative flex min-h-0 flex-1 flex-col py-3"
        >
          <div
            aria-hidden="true"
            className="atlas-spine-rule absolute bottom-3 left-[1.6875rem] top-3 lg:left-[1.875rem]"
          />
          <ul className="relative flex flex-1 flex-col gap-1 px-2 lg:px-3">
            {APP_SECTIONS.map((section) => {
              const Icon = section.icon;
              const isActive = activeSection.id === section.id;

              return (
                <li key={section.path}>
                  <Link
                    to={section.path}
                    aria-current={isActive ? "page" : undefined}
                    title={section.label}
                    className={cn(
                      "group relative flex min-h-11 items-center gap-3 rounded-[var(--radius-control)] px-2.5 py-2 text-control outline-none transition-[background,color] duration-[var(--duration-standard)] ease-[var(--ease-interface)]",
                      "focus-visible:ring-2 focus-visible:ring-ring",
                      isActive
                        ? "bg-forest-soft text-forest"
                        : "text-ink-secondary hover:bg-surface-muted hover:text-ink",
                    )}
                  >
                    {isActive ? (
                      <span
                        aria-hidden="true"
                        className="absolute -left-1 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-coral lg:-left-0.5"
                      />
                    ) : null}
                    <Icon className="size-4 shrink-0" aria-hidden="true" />
                    <span className="hidden truncate lg:inline">
                      {section.label}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="hidden border-t border-line px-4 py-3 text-caption text-ink-muted lg:grid lg:gap-1.5">
          <p className="tabular-nums text-ink-secondary">
            {routeStats.route_count} routes
          </p>
          <p className="tabular-nums">
            {routeStats.completed_km.toFixed(0)} km inked
          </p>
        </div>
      </aside> : null}

      <nav
        data-testid="atlas-spine-mobile"
        aria-label="Primary"
        className="atlas-spine-mobile fixed inset-x-0 bottom-0 z-[var(--z-navigation)] grid h-[var(--mobile-navigation-height)] grid-cols-5 md:hidden"
      >
        {APP_SECTIONS.map((section) => {
          const Icon = section.icon;
          const isActive = activeSection.id === section.id;

          return (
            <Link
              key={section.path}
              to={section.path}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "relative flex min-h-12 flex-col items-center justify-center gap-1 px-1 text-micro outline-none transition-colors duration-[var(--duration-standard)] ease-[var(--ease-interface)]",
                "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                isActive ? "text-forest" : "text-ink-muted",
              )}
            >
              {isActive ? (
                <span
                  aria-hidden="true"
                  className="absolute top-1.5 size-1 rounded-full bg-coral"
                />
              ) : null}
              <Icon className="size-4" aria-hidden="true" />
              <span className="truncate">{section.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}

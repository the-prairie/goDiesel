import { ChevronDown, RotateCcw, Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";

import { RouteCard } from "@/ui/route-card";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { usePlannedRoutes } from "@/data/planned-route-store";
import {
  hasRouteLibraryScroll,
  rememberRouteLibraryReturn,
  takeRouteLibraryScroll,
} from "@/data/route-library-return";
import { routes } from "@/data/routes";
import {
  DEFAULT_ROUTE_FILTERS,
  filterRoutes,
  type RouteFilters,
} from "@/surfaces/routes/route-filters";

const distanceOptions = [
  ["all", "Any distance"],
  ["under-10", "Under 10 km"],
  ["10-20", "10 to 20 km"],
  ["20-50", "20 to 50 km"],
  ["50-plus", "50 km or more"],
] as const;

const climbOptions = [
  ["all", "Any climb"],
  ["under-250", "Under 250 m"],
  ["250-750", "250 to 750 m"],
  ["750-plus", "750 m or more"],
] as const;

const lifecycleOptions = [
  ["all", "Atlas routes"],
  ["completed", "Memories"],
  ["planned", "Planned routes"],
  ["discovered", "Discovered routes"],
] as const;

const collectionTabs = lifecycleOptions;

const routesPerPage = 24;

export function RoutesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const [showFilters, setShowFilters] = useState(false);
  const localPlans = usePlannedRoutes();
  const libraryRoutes = useMemo(() => [...routes, ...localPlans], [localPlans]);
  const activityOptions = useMemo(
    () => uniqueValues(libraryRoutes.map((route) => route.type)),
    [libraryRoutes],
  );
  const regionOptions = useMemo(
    () => uniqueValues(libraryRoutes.map((route) => route.region)),
    [libraryRoutes],
  );
  const vibeOptions = useMemo(
    () => uniqueValues(libraryRoutes.map((route) => route.theme)),
    [libraryRoutes],
  );
  const filters = filtersFromParams(searchParams, {
    activities: activityOptions,
    regions: regionOptions,
    vibes: vibeOptions,
  });
  const routesInView =
    filters.lifecycle === "planned"
      ? libraryRoutes
      : libraryRoutes.filter((route) => route.lifecycle !== "planned");
  const matchingRoutes = filterRoutes(routesInView, filters);
  const maximumPage = Math.max(1, Math.ceil(matchingRoutes.length / routesPerPage));
  const page = Math.min(pageFromParams(searchParams), maximumPage);
  const visibleRoutes = matchingRoutes.slice(0, page * routesPerPage);
  const returnPath = `${location.pathname}${location.search}`;
  const restoresLibraryScroll = hasRouteLibraryScroll(returnPath);
  const hasFilters = Object.entries(filters).some(
    ([key, value]) => value !== DEFAULT_ROUTE_FILTERS[key as keyof RouteFilters],
  );
  const appliedFilters = appliedFilterLabels(filters);

  useEffect(() => {
    const canonical = paramsFromFilters(filters, page);
    if (canonical.toString() !== searchParams.toString()) {
      setSearchParams(canonical, { replace: true });
    }
  }, [filters, page, searchParams, setSearchParams]);

  useLayoutEffect(() => {
    const scrollY = takeRouteLibraryScroll(returnPath);
    if (scrollY === undefined) return;
    window.scrollTo(0, scrollY);
  }, [returnPath, visibleRoutes.length]);

  function updateFilter<K extends keyof RouteFilters>(key: K, value: RouteFilters[K]) {
    const next = paramsFromFilters(filters);
    const parameter = key === "query" ? "q" : key;
    const defaultValue = DEFAULT_ROUTE_FILTERS[key];
    if (value === defaultValue) next.delete(parameter);
    else next.set(parameter, value);
    setSearchParams(next, { replace: true });
  }

  return (
    <section
      className="min-h-[calc(100dvh-var(--mobile-navigation-height))] bg-[#edf1ee] md:min-h-dvh"
      data-navigation-window-scroll={restoresLibraryScroll ? "managed" : undefined}
    >
      <header className="bg-[#0b292b] text-white">
        <div className="mx-auto max-w-[86rem] px-4 pb-8 pt-8 sm:px-6 md:pb-14 md:pt-28 lg:px-8">
          <div className="flex flex-col justify-between gap-8 md:flex-row md:items-end">
            <div className="max-w-4xl">
              <p className="text-control font-semibold text-[#9be7e1]">Personal route atlas</p>
              <h1 className="mt-3 text-balance font-editorial text-4xl font-semibold leading-[0.96] text-white sm:text-6xl sm:leading-[0.94]">
                {filters.lifecycle === "planned"
                  ? "Routes waiting to be made."
                  : "The routes that made the map."}
              </h1>
              <p className="mt-4 max-w-2xl text-pretty text-body leading-7 text-white/70">
                {filters.lifecycle === "planned"
                  ? "Review a planned route, then return to Finder to shape the next experience."
                  : "Find a recorded memory or discovered route by place, personal title, effort, or vibe."}
              </p>
            </div>
            <p className="border-l border-white/25 pl-4 text-caption leading-5 text-white/62">
              {libraryRoutes.length} routes across {regionOptions.length} places
              <br />Recorded, imported, and intentionally planned.
            </p>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[86rem] content-start gap-6 px-4 pb-12 sm:px-6 lg:px-8">
        {libraryRoutes.length === 0 ? (
          <LibraryState
            title="No routes yet"
            copy="Imported and planned routes will appear here when the library has data."
          />
        ) : (
          <>
          <form
            aria-label="Route filters"
            className="relative z-10 -mt-4 grid gap-4 border border-line bg-surface-raised p-4 md:-mt-6 md:p-5"
            onSubmit={(event) => event.preventDefault()}
          >
            <div
              role="group"
              aria-label="Route collections"
              className="grid min-w-0 grid-cols-2 gap-1 border-b border-line pb-4 sm:flex sm:overflow-x-auto sm:[scrollbar-width:none] sm:[&::-webkit-scrollbar]:hidden"
            >
              {collectionTabs.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={filters.lifecycle === value}
                  className={
                    filters.lifecycle === value
                      ? "min-h-11 shrink-0 bg-forest px-2 text-control font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-4"
                      : "min-h-11 shrink-0 px-2 text-control font-medium text-ink-secondary outline-none hover:bg-surface-muted hover:text-ink focus-visible:ring-2 focus-visible:ring-ring sm:px-4"
                  }
                  onClick={() => updateFilter("lifecycle", value)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex max-w-4xl gap-2">
              <div className="relative min-w-0 flex-1">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  type="search"
                  aria-label="Search routes"
                  value={filters.query}
                  placeholder="Search routes"
                  className="pl-9 pr-12"
                  onChange={(event) => updateFilter("query", event.target.value)}
                />
                {filters.query ? (
                  <button
                    type="button"
                    aria-label="Clear route search"
                    className="absolute right-0 top-1/2 grid size-11 -translate-y-1/2 place-items-center text-ink-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => updateFilter("query", "")}
                  >
                    <X className="size-4" aria-hidden="true" />
                  </button>
                ) : null}
              </div>
              <Button
                type="button"
                variant="outline"
                aria-expanded={showFilters}
                aria-controls="route-filter-options"
                onClick={() => setShowFilters((visible) => !visible)}
              >
                <SlidersHorizontal aria-hidden="true" />
                Filters{appliedFilters.length ? ` · ${appliedFilters.length}` : ""}
                <ChevronDown
                  aria-hidden="true"
                  className={showFilters ? "rotate-180 transition-transform" : "transition-transform"}
                />
              </Button>
            </div>

            <div
              id="route-filter-options"
              className={`${showFilters ? "grid" : "hidden"} gap-3 border-t border-line pt-4 sm:grid-cols-2 xl:grid-cols-3`}
            >
              <FilterSelect
                label="Collection"
                value={filters.lifecycle}
                options={lifecycleOptions}
                onChange={(value) =>
                  updateFilter("lifecycle", value as RouteFilters["lifecycle"])
                }
              />
              <FilterSelect
                label="Activity"
                value={filters.activity}
                options={withAllOption(activityOptions, "Any activity")}
                onChange={(value) => updateFilter("activity", value)}
              />
              <FilterSelect
                label="Region"
                value={filters.region}
                options={withAllOption(regionOptions, "Any region")}
                onChange={(value) => updateFilter("region", value)}
              />
              <FilterSelect
                label="Distance"
                value={filters.distance}
                options={distanceOptions}
                onChange={(value) =>
                  updateFilter("distance", value as RouteFilters["distance"])
                }
              />
              <FilterSelect
                label="Climb"
                value={filters.climb}
                options={climbOptions}
                onChange={(value) =>
                  updateFilter("climb", value as RouteFilters["climb"])
                }
              />
              <FilterSelect
                label="Vibe"
                value={filters.vibe}
                options={withAllOption(vibeOptions, "Any vibe")}
                onChange={(value) => updateFilter("vibe", value)}
              />
            </div>

            {appliedFilters.length ? (
              <div role="group" aria-label="Applied route filters" className="flex flex-wrap gap-2">
                {appliedFilters.map((filter) => (
                  <button
                    key={filter.key}
                    type="button"
                    aria-label={`Remove ${filter.label} filter`}
                    className="inline-flex min-h-11 items-center gap-2 border border-line bg-surface-muted px-2.5 text-caption text-ink outline-none hover:border-line-strong focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => updateFilter(filter.key, DEFAULT_ROUTE_FILTERS[filter.key])}
                  >
                    <span className="text-ink-muted">{filter.label}</span>
                    <span className="font-medium">{filter.value}</span>
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                ))}
              </div>
            ) : null}
          </form>

          <div className="flex min-h-9 flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
            <p
              aria-live="polite"
              data-testid="route-result-count"
              data-total={matchingRoutes.length}
              className="text-sm text-muted-foreground"
            >
              <span className="font-medium text-foreground">
                {visibleRoutes.length === matchingRoutes.length
                  ? matchingRoutes.length
                  : `Showing ${visibleRoutes.length} of ${matchingRoutes.length}`}
              </span>{" "}
              {matchingRoutes.length === 1 ? "route" : "routes"}
            </p>
            {hasFilters ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setSearchParams({}, { replace: true })}
              >
                <RotateCcw aria-hidden="true" />
                Reset filters
              </Button>
            ) : null}
          </div>

          <section aria-label="Route results">
            {matchingRoutes.length === 0 ? (
              <LibraryState
                title="No routes found"
                copy="Try a broader place, effort, or vibe."
                role="status"
                action={
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setSearchParams({}, { replace: true })}
                  >
                    <RotateCcw aria-hidden="true" />
                    Reset filters
                  </Button>
                }
              />
            ) : (
              <div className="grid gap-6">
                <div data-testid="route-memory-grid" className="grid items-stretch gap-5 lg:grid-cols-2">
                  {visibleRoutes.map((route) => (
                    <RouteCard
                      key={route.slug}
                      route={route}
                      onOpen={() =>
                        rememberRouteLibraryReturn(
                          returnPath,
                          route.slug,
                          window.scrollY,
                        )
                      }
                    />
                  ))}
                </div>
                {visibleRoutes.length < matchingRoutes.length ? (
                  <div className="flex justify-center border-t border-border pt-5">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        setSearchParams(paramsFromFilters(filters, page + 1), {
                          replace: true,
                        })
                      }
                    >
                      Load more routes
                    </Button>
                  </div>
                ) : null}
              </div>
            )}
          </section>
          </>
        )}
      </div>
    </section>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
      {label}
      <select
        value={value}
        className="h-11 min-w-0 rounded-md border border-border bg-card px-3 text-sm text-foreground outline-none transition-colors hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring"
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

function LibraryState({
  title,
  copy,
  action,
  role,
}: {
  title: string;
  copy: string;
  action?: React.ReactNode;
  role?: "status";
}) {
  return (
    <div
      role={role}
      className="grid min-h-64 place-items-center border-y border-border py-12 text-center"
    >
      <div className="grid max-w-md justify-items-center gap-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{copy}</p>
        {action}
      </div>
    </div>
  );
}

function uniqueValues(values: string[]) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function withAllOption(values: string[], label: string) {
  return [
    ["all", label] as const,
    ...values.map((value) => [value, value] as const),
  ];
}

function appliedFilterLabels(filters: RouteFilters) {
  const labels: Partial<Record<keyof RouteFilters, string>> = {
    lifecycle: "Collection",
    activity: "Activity",
    region: "Place",
    distance: "Distance",
    climb: "Climb",
    vibe: "Vibe",
  };
  return (Object.entries(filters) as [keyof RouteFilters, string][])
    .filter(([key, value]) => key !== "query" && value !== DEFAULT_ROUTE_FILTERS[key])
    .map(([key, value]) => ({
      key,
      label: labels[key] ?? key,
      value: filterValueLabel(key, value),
    }));
}

function filterValueLabel(key: keyof RouteFilters, value: string) {
  if (key === "lifecycle") {
    return lifecycleOptions.find(([option]) => option === value)?.[1] ?? value;
  }
  if (key === "distance") {
    return distanceOptions.find(([option]) => option === value)?.[1] ?? value;
  }
  if (key === "climb") {
    return climbOptions.find(([option]) => option === value)?.[1] ?? value;
  }
  return value;
}

function filtersFromParams(
  params: URLSearchParams,
  options: { activities: string[]; regions: string[]; vibes: string[] },
): RouteFilters {
  return {
    query: params.get("q") ?? "",
    lifecycle: valueIn(params.get("lifecycle"), ["completed", "planned", "discovered"])
      ? (params.get("lifecycle") as RouteFilters["lifecycle"])
      : "all",
    activity: valueIn(params.get("activity"), options.activities)
      ? (params.get("activity") as string)
      : "all",
    region: valueIn(params.get("region"), options.regions)
      ? (params.get("region") as string)
      : "all",
    distance: valueIn(params.get("distance"), ["under-10", "10-20", "20-50", "50-plus"])
      ? (params.get("distance") as RouteFilters["distance"])
      : "all",
    climb: valueIn(params.get("climb"), ["under-250", "250-750", "750-plus"])
      ? (params.get("climb") as RouteFilters["climb"])
      : "all",
    vibe: valueIn(params.get("vibe"), options.vibes)
      ? (params.get("vibe") as string)
      : "all",
  };
}

function valueIn(value: string | null, allowed: readonly string[]): value is string {
  return value !== null && allowed.includes(value);
}

function pageFromParams(params: URLSearchParams) {
  const value = Number(params.get("page"));
  return Number.isInteger(value) && value > 1 ? value : 1;
}

function paramsFromFilters(filters: RouteFilters, page = 1) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters) as [
    keyof RouteFilters,
    RouteFilters[keyof RouteFilters],
  ][]) {
    if (value === DEFAULT_ROUTE_FILTERS[key]) continue;
    params.set(key === "query" ? "q" : key, value);
  }
  if (page > 1) params.set("page", String(page));
  return params;
}

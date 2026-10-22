import { useExternalPlans } from "@/data/external-plan-store";
import { filterExternalPlans } from "@/surfaces/routes/external-plan-filters";
import { ExternalPlanCard } from "./components/external-plan-card";
import { ChevronDown, RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";

import { PageTitle } from "@/ui/page-title";
import { RouteCard } from "@/ui/route-card";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { SelectField } from "@/ui/select-field";
import { usePlannedRoutes } from "@/data/planned-route-store";
import {
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
  ["all", "Any status"],
  ["completed", "Completed"],
  ["planned", "Planned"],
  ["discovered", "Discovered"],
] as const;

const routesPerPage = 24;

export function RoutesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const externalPlans = useExternalPlans();
  const localPlans = usePlannedRoutes();
  const libraryRoutes = useMemo(() => [...routes, ...localPlans], [localPlans]);
  const activityOptions = useMemo(
    () => uniqueValues([...libraryRoutes.map((route) => route.type), ...externalPlans.map(p=>p.route.activity)]),
    [libraryRoutes, externalPlans],
  );
  const regionOptions = useMemo(
    () => uniqueValues([...libraryRoutes.map((route) => route.region), ...externalPlans.map(p=>p.place)]),
    [libraryRoutes, externalPlans],
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
  const matchingExternalPlans = filterExternalPlans(externalPlans, filters);
  const matchingRoutes = filterRoutes(libraryRoutes, filters);
  const maximumPage = Math.max(1, Math.ceil(matchingRoutes.length / routesPerPage));
  const page = Math.min(pageFromParams(searchParams), maximumPage);
  const visibleRoutes = matchingRoutes.slice(0, page * routesPerPage);
  const returnPath = `${location.pathname}${location.search}`;
  const hasFilters = Object.entries(filters).some(
    ([key, value]) => value !== DEFAULT_ROUTE_FILTERS[key as keyof RouteFilters],
  );

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
    <section className="grid content-start gap-6">
      <PageTitle
        eyebrow="Your collection"
        title="Places worth returning to."
        copy="Your runs, rides, and plans. Find a place and revisit the day."
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild><Link to="/courses">Create or import route</Link></Button>
        <p className="text-sm text-ink-secondary">Plan a loop, upload GPX, or open courses made by your agent.</p>
      </div>

      {libraryRoutes.length + externalPlans.length === 0 ? (
        <LibraryState
          title="No routes yet"
          copy="Imported and planned routes will appear here when the library has data."
        />
      ) : (
        <>
          <form
            aria-label="Route filters"
            className="grid gap-4 rounded-2xl border border-line bg-surface p-3 sm:p-4"
            onSubmit={(event) => event.preventDefault()}
          >
            <div className="flex max-w-2xl gap-2">
              <div className="relative min-w-0 flex-1">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  type="search"
                  aria-label="Search routes"
                  value={filters.query}
                  placeholder="Search your routes"
                  className="pl-9"
                  onChange={(event) => updateFilter("query", event.target.value)}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                aria-expanded={showMobileFilters}
                aria-controls="route-filter-options"
                className="shrink-0"
                onClick={() => setShowMobileFilters((visible) => !visible)}
              >
                <SlidersHorizontal aria-hidden="true" />
                Filters
                <ChevronDown
                  aria-hidden="true"
                  className={showMobileFilters ? "rotate-180 transition-transform" : "transition-transform"}
                />
              </Button>
            </div>

            <div
              id="route-filter-options"
              className={`${showMobileFilters ? "grid" : "hidden"} gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6`}
            >
              <FilterSelect
                label="Status"
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
          </form>

          <div className="flex min-h-9 flex-wrap items-center justify-between gap-3">
            <p
              aria-live="polite"
              data-testid="route-result-count"
              data-total={matchingRoutes.length}
              className="text-sm text-muted-foreground"
            >
              <span className="font-medium text-foreground">
                {visibleRoutes.length === matchingRoutes.length
                  ? matchingRoutes.length + matchingExternalPlans.length
                  : `Showing ${visibleRoutes.length + matchingExternalPlans.length} of ${matchingRoutes.length + matchingExternalPlans.length}`}
              </span>{" "}
              {matchingRoutes.length + matchingExternalPlans.length === 1 ? "route" : "routes"}
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

          <section aria-label="Route results" data-testid="route-ledger">
            {matchingRoutes.length + matchingExternalPlans.length === 0 ? (
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
              <div className="grid gap-5">
                {matchingExternalPlans.length ? <section aria-label="Saved discoveries" className="grid gap-3">
                  <h2 className="text-lg">Saved discoveries</h2>
                  <div className="grid items-start gap-4 lg:grid-cols-2">{matchingExternalPlans.map(plan=><ExternalPlanCard key={plan.route.id} plan={plan}/>)}</div>
                </section> : null}
                <div className="field-notes-grid">
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
                {visibleRoutes.length > 0 ? <p className="text-xs text-ink-secondary">Cover artwork based on <a className="underline underline-offset-2" href="https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9" target="_blank" rel="noreferrer">Esri World Imagery</a>.</p> : null}
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
    <SelectField
      label={label}
      value={value}
      options={options}
      onChange={onChange}
      className="text-xs"
    />
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

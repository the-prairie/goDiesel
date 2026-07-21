import { Search } from "lucide-react";
import { useDeferredValue, useMemo } from "react";

import type { RouteRegion } from "@/data/route-regions";
import type { RouteSummary } from "@/domain/routes";
import { cn } from "@/lib/utils";

type AtlasSearchState =
  | "initial"
  | "typing"
  | "loading"
  | "grouped-results"
  | "no-results"
  | "selected-result"
  | "unsupported-query";

interface AtlasSearchProps {
  routes: RouteSummary[];
  regions: RouteRegion[];
  onSelectRegion: (region: RouteRegion) => void;
  onSelectRoute: (route: RouteSummary) => void;
  query: string;
  onQueryChange: (query: string) => void;
  selectedRegion?: RouteRegion;
  selectedRoute?: RouteSummary;
  className?: string;
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function isUnsupportedQuery(query: string) {
  return /^(plan|find|near|suggest)\b/i.test(query.trim());
}

function searchState({
  query,
  deferredQuery,
  hasResults,
  selectionActive,
  unsupported,
}: {
  query: string;
  deferredQuery: string;
  hasResults: boolean;
  selectionActive: boolean;
  unsupported: boolean;
}): AtlasSearchState {
  if (selectionActive && query !== "") return "selected-result";
  if (query === "") return "initial";
  if (unsupported) return "unsupported-query";
  if (query !== deferredQuery) return "loading";
  if (hasResults) return "grouped-results";
  if (query.trim().length < 2) return "typing";
  return "no-results";
}

export function AtlasSearch({
  routes,
  regions,
  onSelectRegion,
  onSelectRoute,
  query,
  onQueryChange,
  selectedRegion,
  selectedRoute,
  className,
}: AtlasSearchProps) {
  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = normalize(deferredQuery);
  const unsupported = query.length > 0 && isUnsupportedQuery(query);

  const results = useMemo(() => {
    if (!normalizedQuery || unsupported) {
      return { regions: [], routes: [], replay: [] };
    }

    const scopedRoutes = selectedRegion?.routes ?? routes;
    return {
      regions: selectedRegion ? [] : regions
        .filter((region) => region.name.toLowerCase().includes(normalizedQuery))
        .slice(0, 6),
      routes: scopedRoutes
        .filter((route) =>
          [
            route.name,
            route.subtitle,
            route.activityName,
            route.region,
            route.type,
            route.theme,
            route.difficulty,
          ]
            .join(" ")
            .toLowerCase()
            .includes(normalizedQuery),
        )
        .slice(0, 8),
      replay: selectedRegion ? [] : routes
        .filter((route) => route.replay.bestInEarth)
        .filter((route) =>
          [route.name, route.subtitle, route.region].join(" ").toLowerCase().includes(normalizedQuery),
        )
        .slice(0, 4),
    };
  }, [normalizedQuery, regions, routes, selectedRegion, unsupported]);

  const hasResults =
    results.regions.length > 0 || results.routes.length > 0 || results.replay.length > 0;
  const state = searchState({
    query,
    deferredQuery,
    hasResults,
    selectionActive: Boolean(selectedRoute),
    unsupported,
  });

  function selectRegion(region: RouteRegion) {
    onSelectRegion(region);
  }

  function selectRoute(route: RouteSummary) {
    onSelectRoute(route);
  }

  return (
    <section
      className={cn(
        "rounded-sm border border-white/35 bg-[#f6f2e8]/94 p-3 text-[#24322d] shadow-lg backdrop-blur",
        className,
      )}
      aria-label="Atlas search"
      data-state={state}
    >
      <label className="sr-only">
        {selectedRegion ? `Search ${selectedRegion.name}` : "Search memories"}
      </label>
      <div className="flex min-h-11 items-center gap-3 rounded-sm border border-[#c7c1b5] bg-[#fffdf8] px-3 focus-within:ring-2 focus-within:ring-[#315fb4]">
        <Search className="size-4 text-[#5d685f]" aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => {
            onQueryChange(event.target.value);
          }}
          aria-label={selectedRegion ? "Search this place" : "Search regions, routes, replay-worthy days"}
          placeholder={selectedRegion ? "Search this place" : "Search places and routes"}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[#6e756e]"
        />
      </div>

      <div className={cn("atlas-search-status text-sm text-[#626a64]", state === "initial" ? "sr-only" : "mt-3")}>
        {state === "initial" && "Start with a place, route name, ride, run, or replay quality."}
        {state === "typing" && "Keep typing to search completed route memories."}
        {state === "loading" && "Searching completed memories."}
        {state === "no-results" &&
          (selectedRegion
            ? `No routes in ${selectedRegion.name} match that search.`
            : "No completed memories match that search.")}
        {state === "selected-result" && "Selected result is focused on the atlas."}
        {state === "unsupported-query" &&
          "Planning queries belong in Finder; Atlas only searches completed memories."}
        {state === "grouped-results" && "Grouped results"}
      </div>

      {state === "grouped-results" ? (
        <div className="atlas-search-results mt-4 grid gap-4">
          <ResultGroup title="Regions">
            {results.regions.map((region) => (
              <button
                key={region.name}
                type="button"
                onClick={() => selectRegion(region)}
                className="rounded-md border border-border px-3 py-2 text-left text-sm hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <b>{region.name}</b>
                <span className="ml-2 text-muted-foreground">
                  {region.routes.length} routes · {region.totalKm.toFixed(0)} km
                </span>
              </button>
            ))}
          </ResultGroup>

          <ResultGroup title={selectedRegion ? `Routes in ${selectedRegion.name}` : "Routes"}>
            {results.routes.map((route) => (
              <button
                key={route.slug}
                type="button"
                onClick={() => selectRoute(route)}
                aria-pressed={selectedRoute?.slug === route.slug}
                className="rounded-md border border-border px-3 py-2 text-left text-sm hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <b>{route.name}</b>
                <span className="ml-2 text-muted-foreground">
                  {route.type} · {route.distanceKm.toFixed(1)} km
                </span>
              </button>
            ))}
          </ResultGroup>

          <ResultGroup title="Best in Earth">
            {results.replay.map((route) => (
              <button
                key={route.slug}
                type="button"
                onClick={() => selectRoute(route)}
                aria-pressed={selectedRoute?.slug === route.slug}
                className="rounded-md border border-border px-3 py-2 text-left text-sm hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <b>{route.name}</b>
                <span className="ml-2 text-muted-foreground">{route.difficulty}</span>
              </button>
            ))}
          </ResultGroup>
        </div>
      ) : null}
    </section>
  );
}

function ResultGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  if (!hasChildren) return null;

  return (
    <div className="grid gap-2">
      <div className="text-xs font-semibold uppercase text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  );
}

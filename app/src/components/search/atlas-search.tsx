import { Search, X } from "lucide-react";
import { useDeferredValue, useMemo } from "react";

import type { AtlasActivityMode } from "@/components/globe/atlas-controls";
import { Button } from "@/components/ui/button";
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
  mode: AtlasActivityMode;
  onModeChange: (mode: AtlasActivityMode) => void;
  onClose: () => void;
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
  mode,
  onModeChange,
  onClose,
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
        "border border-white/18 bg-[#061017]/94 p-4 text-white shadow-2xl backdrop-blur-xl",
        className,
      )}
      aria-label="Atlas search"
      data-state={state}
    >
      <header className="mb-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase text-[#8de8d2]">
            {selectedRegion ? "Search this place" : "Find a memory"}
          </p>
          <h2 className="mt-1 font-editorial text-2xl font-semibold">
            {selectedRegion?.name ?? "Your world"}
          </h2>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Close Atlas search"
          onClick={onClose}
          className="size-10 rounded-sm text-white/72 hover:bg-white/10 hover:text-white"
        >
          <X aria-hidden="true" />
        </Button>
      </header>

      <label className="sr-only">
        {selectedRegion ? `Search ${selectedRegion.name}` : "Search memories"}
      </label>
      <div className="flex min-h-12 items-center gap-3 border border-white/22 bg-white/8 px-3 focus-within:ring-2 focus-within:ring-[#8de8d2]">
        <Search className="size-4 text-white/52" aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => {
            onQueryChange(event.target.value);
          }}
          aria-label={selectedRegion ? "Search this place" : "Search regions, routes, replay-worthy days"}
          placeholder={selectedRegion ? "Search this place" : "Search places and routes"}
          autoFocus
          className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/42"
        />
      </div>

      {!selectedRegion ? (
        <div
          className="mt-3 grid grid-cols-3 border border-white/16 p-1"
          aria-label="Activity filter"
        >
          {(["all", "runs", "rides"] as const).map((value) => (
            <Button
              key={value}
              type="button"
              variant="ghost"
              aria-label={`Show ${value === "all" ? "all activities" : value}`}
              aria-pressed={mode === value}
              onClick={() => onModeChange(value)}
              className="h-10 rounded-sm text-white/62 hover:bg-white/8 hover:text-white aria-pressed:bg-white aria-pressed:text-[#10201b]"
            >
              {value[0].toUpperCase() + value.slice(1)}
            </Button>
          ))}
        </div>
      ) : null}

      <div className={cn("atlas-search-status text-sm text-white/58", state === "initial" ? "sr-only" : "mt-3")}>
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

      {state === "initial" && !selectedRegion ? (
        <ResultGroup title="Places">
          {regions.slice(0, 8).map((region) => (
            <button
              key={region.name}
              type="button"
              onClick={() => selectRegion(region)}
              className="flex min-h-12 items-center justify-between gap-4 border-b border-white/10 px-1 text-left text-sm outline-none transition-colors last:border-b-0 hover:text-[#8de8d2] focus-visible:ring-2 focus-visible:ring-[#8de8d2]"
            >
              <span className="font-editorial text-base">{region.name}</span>
              <span className="text-xs tabular-nums text-white/48">
                {region.routes.length} journeys · {region.totalKm.toFixed(0)} km
              </span>
            </button>
          ))}
        </ResultGroup>
      ) : null}

      {state === "grouped-results" ? (
        <div className="atlas-search-results mt-4 grid gap-4">
          <ResultGroup title="Regions">
            {results.regions.map((region) => (
              <button
                key={region.name}
                type="button"
                onClick={() => selectRegion(region)}
                className="border-b border-white/10 px-1 py-3 text-left text-sm hover:text-[#8de8d2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8de8d2]"
              >
                <b>{region.name}</b>
                <span className="ml-2 text-white/48">
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
                className="border-b border-white/10 px-1 py-3 text-left text-sm hover:text-[#8de8d2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8de8d2]"
              >
                <b>{route.name}</b>
                <span className="ml-2 text-white/48">
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
                className="border-b border-white/10 px-1 py-3 text-left text-sm hover:text-[#8de8d2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8de8d2]"
              >
                <b>{route.name}</b>
                <span className="ml-2 text-white/48">{route.difficulty}</span>
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
    <div className="mt-4 grid gap-1">
      <div className="mb-1 text-xs font-semibold uppercase text-[#8de8d2]">
        {title}
      </div>
      {children}
    </div>
  );
}

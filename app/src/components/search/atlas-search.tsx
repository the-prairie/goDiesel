import { Search } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";

import type { RouteRegion } from "@/data/route-regions";
import type { QuestRoute } from "@/domain/routes";

interface SelectedSearchResult {
  key: string;
  query: string;
}

type AtlasSearchState =
  | "initial"
  | "typing"
  | "loading"
  | "grouped-results"
  | "no-results"
  | "selected-result"
  | "unsupported-query";

interface AtlasSearchProps {
  routes: QuestRoute[];
  regions: RouteRegion[];
  onSelectRegion: (region: RouteRegion) => void;
  onOpenRoute: (route: QuestRoute) => void;
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
  selectedResult,
  unsupported,
}: {
  query: string;
  deferredQuery: string;
  hasResults: boolean;
  selectedResult: SelectedSearchResult | null;
  unsupported: boolean;
}): AtlasSearchState {
  if (selectedResult?.key && selectedResult.query === query) return "selected-result";
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
  onOpenRoute,
}: AtlasSearchProps) {
  const [query, setQuery] = useState("");
  const [selectedResult, setSelectedResult] = useState<SelectedSearchResult | null>(null);
  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = normalize(deferredQuery);
  const unsupported = query.length > 0 && isUnsupportedQuery(query);

  const results = useMemo(() => {
    if (!normalizedQuery || unsupported) {
      return { regions: [], routes: [], replay: [] };
    }

    return {
      regions: regions
        .filter((region) => region.name.toLowerCase().includes(normalizedQuery))
        .slice(0, 6),
      routes: routes
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
      replay: routes
        .filter((route) => route.replay.bestInEarth)
        .filter((route) =>
          [route.name, route.subtitle, route.region].join(" ").toLowerCase().includes(normalizedQuery),
        )
        .slice(0, 4),
    };
  }, [normalizedQuery, regions, routes, unsupported]);

  const hasResults =
    results.regions.length > 0 || results.routes.length > 0 || results.replay.length > 0;
  const state = searchState({
    query,
    deferredQuery,
    hasResults,
    selectedResult,
    unsupported,
  });

  function selectRegion(region: RouteRegion) {
    setSelectedResult({ key: `region:${region.name}`, query: region.name });
    setQuery(region.name);
    onSelectRegion(region);
  }

  function selectRoute(route: QuestRoute) {
    setSelectedResult({ key: `route:${route.slug}`, query: route.name });
    setQuery(route.name);
    onOpenRoute(route);
  }

  return (
    <section
      className="rounded-md border border-border bg-card p-4"
      aria-label="Atlas search"
      data-state={state}
    >
      <label className="text-xs font-semibold uppercase text-primary">
        Search memories
      </label>
      <div className="mt-3 flex min-h-11 items-center gap-3 rounded-md border border-border bg-background px-3 focus-within:ring-2 focus-within:ring-ring">
        <Search className="size-4 text-muted-foreground" aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelectedResult(null);
          }}
          placeholder="Search regions, routes, replay-worthy days"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>

      <div className="mt-3 text-sm text-muted-foreground">
        {state === "initial" && "Start with a place, route name, ride, run, or replay quality."}
        {state === "typing" && "Keep typing to search completed route memories."}
        {state === "loading" && "Searching completed memories."}
        {state === "no-results" && "No completed memories match that search."}
        {state === "selected-result" && "Selected result is focused on the atlas."}
        {state === "unsupported-query" &&
          "Planning queries belong in Finder; Atlas only searches completed memories."}
        {state === "grouped-results" && "Grouped results"}
      </div>

      {state === "grouped-results" ? (
        <div className="mt-4 grid gap-4">
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

          <ResultGroup title="Routes">
            {results.routes.map((route) => (
              <button
                key={route.slug}
                type="button"
                onClick={() => selectRoute(route)}
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

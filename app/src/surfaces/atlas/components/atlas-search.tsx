import { Search, SlidersHorizontal, X, Settings, Check, MapPin } from "lucide-react";
import { useDeferredValue, useMemo, useState, useRef, useEffect } from "react";

import { Link } from "react-router-dom";
import { Button } from "@/ui/button";

import type { RouteRegion } from "@/data/route-regions";
import type { RouteSummary } from "@/domain/route";
import { cn } from "@/ui/utils";

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
  const panelRef = useRef<HTMLElement>(null);
  const optionsButtonRef = useRef<HTMLButtonElement>(null);
  const [searchOpen, setSearchOpen] = useState(
    Boolean(query) && !selectedRegion,
  );
  useEffect(() => {
    if (!searchOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) setSearchOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [searchOpen]);
  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = normalize(deferredQuery);
  const unsupported = query.length > 0 && isUnsupportedQuery(query);

  const results = useMemo(() => {
    if (!normalizedQuery || unsupported) {
      return { regions: [], routes: [], replay: [] };
    }

    const scopedRoutes = selectedRegion?.routes ?? routes;
    return {
      regions: regions
            .filter((region) =>
              region.name.toLowerCase().includes(normalizedQuery),
            )
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
      replay: selectedRegion
        ? []
        : routes
            .filter((route) => route.replay.bestInEarth)
            .filter((route) =>
              [route.name, route.subtitle, route.region]
                .join(" ")
                .toLowerCase()
                .includes(normalizedQuery),
            )
            .slice(0, 4),
    };
  }, [normalizedQuery, regions, routes, selectedRegion, unsupported]);

  const hasResults =
    results.regions.length > 0 ||
    results.routes.length > 0 ||
    results.replay.length > 0;
  const state = searchState({
    query,
    deferredQuery,
    hasResults,
    selectionActive: Boolean(selectedRoute) && !searchOpen,
    unsupported,
  });

  function selectRegion(region: RouteRegion) {
    setSearchOpen(false);
    onSelectRegion(region);
    optionsButtonRef.current?.focus();
  }

  function selectRoute(route: RouteSummary) {
    setSearchOpen(false);
    onSelectRoute(route);
  }

  return (
    <section
      ref={panelRef}
      className={cn(
        "relative min-w-0 rounded-xl border border-line bg-surface text-ink shadow-panel",
        className,
      )}
      onKeyDown={(event) => {
        if (event.key === "Escape" && searchOpen) {
          event.preventDefault();
          event.stopPropagation();
          setSearchOpen(false);
          optionsButtonRef.current?.focus();
        }
      }}
      aria-label="Atlas search"
      data-state={state}
    >
      <label className="sr-only">
        {selectedRegion ? `Search ${selectedRegion.name}` : "Search memories"}
      </label>
      <div className="ember-field flex min-h-12 items-center gap-2 rounded-[var(--radius-control)] px-3">
        <Search className="size-4 text-ink-muted" aria-hidden="true" />
        <input
          value={query}
          onFocus={() => setSearchOpen(true)}
          onChange={(event) => {
            setSearchOpen(true);
            onQueryChange(event.target.value);
          }}
          aria-label="Search places and routes"
          placeholder="Search places and routes"
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              const selected = panelRef.current?.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]');
              (selected ?? panelRef.current?.querySelector<HTMLButtonElement>('[role="option"]'))?.focus();
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-ink-muted"
        />
        <Button
          ref={optionsButtonRef}
          type="button"
          variant="ghost"
          size="icon"
          aria-label={searchOpen ? "Close Atlas options" : "Open Atlas options"}
          aria-expanded={searchOpen}
          aria-controls="atlas-search-options"
          onClick={() => setSearchOpen((open) => !open)}
          className="-mr-2 shrink-0"
        >
          {searchOpen ? (
            <X aria-hidden="true" />
          ) : (
            <SlidersHorizontal aria-hidden="true" />
          )}
        </Button>
      </div>
      <div id="atlas-search-options" hidden={!searchOpen} className="max-h-[min(32rem,calc(100dvh-12rem))] overflow-y-auto overscroll-contain rounded-b-[var(--radius-control)] bg-black/95">
        {searchOpen && !unsupported ? (
          <RegionBrowser regions={regions} filter={query} selectedRegion={selectedRegion} onSelect={selectRegion} />
        ) : null}

        <div
          hidden={!searchOpen}
          role="status"
          className={cn(
            "atlas-discovery-status text-sm text-ink-muted",
            state === "initial" || state === "grouped-results" ? "sr-only" : "px-3 py-3",
          )}
        >
          {state === "initial" &&
            "Start with a place, route name, ride, run, or replay quality."}
          {state === "typing" &&
            "Keep typing to search completed route memories."}
          {state === "loading" && "Searching completed memories."}
          {state === "no-results" &&
            "No places or routes match that search. Try another name."}
          {state === "selected-result" &&
            "Selected result is focused on the atlas."}
          {state === "unsupported-query" &&
            "Planning queries belong in Finder; Atlas only searches completed memories."}
          {state === "grouped-results" && "Grouped results"}
        </div>

        {searchOpen && state === "no-results" ? (
          <Button type="button" variant="ghost" size="sm" className="mx-3 mb-3" onClick={() => { onQueryChange(""); panelRef.current?.querySelector("input")?.focus(); }}>Browse all places</Button>
        ) : null}
        {searchOpen && state === "grouped-results" && (results.routes.length > 0 || results.replay.length > 0) ? (
          <div className="atlas-search-results mt-3 grid max-h-[min(40dvh,24rem)] gap-4 overflow-y-auto overscroll-contain p-3 pt-0">
            <ResultGroup
              title={
                selectedRegion ? `Routes in ${selectedRegion.name}` : "Routes"
              }
            >
              {results.routes.map((route) => (
                <button
                  key={route.slug}
                  type="button"
                  onClick={() => selectRoute(route)}
                  aria-pressed={selectedRoute?.slug === route.slug}
                  className="rounded-md border border-border px-3 py-2 text-left text-sm hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                  className="rounded-md border border-border px-3 py-2 text-left text-sm hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <b>{route.name}</b>
                  <span className="ml-2 text-muted-foreground">
                    {route.difficulty}
                  </span>
                </button>
              ))}
            </ResultGroup>
          </div>
        ) : null}
        {searchOpen ? (
          <div className="border-t border-line p-2 md:hidden">
            <Link
              to="/admin"
              className="flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm text-ink-secondary hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-ring"
            >
              <Settings className="size-4" aria-hidden="true" />
              Admin
            </Link>
          </div>
        ) : null}
      </div>
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
  const hasChildren = Array.isArray(children)
    ? children.length > 0
    : Boolean(children);
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

function RegionBrowser({ regions, filter, selectedRegion, onSelect }: {
  filter: string;
  regions: RouteRegion[];
  selectedRegion?: RouteRegion;
  onSelect: (region: RouteRegion) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const visible = useMemo(() => regions
    .filter((region) => normalize(region.name).includes(normalize(filter)))
    .sort((a, b) => a.name.localeCompare(b.name)), [regions, filter]);
  const options = () => Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [selectedRegion?.name, filter]);
  if (!visible.length) return null;
  return (
    <div className="border-t border-line">
      <div className="grid gap-3 p-3">
        <div className="flex items-center justify-between text-xs text-ink-secondary">
          <span className="font-semibold">Go to a place</span>
          <span>{visible.length} {visible.length === 1 ? "place" : "places"}</span>
        </div>

      </div>
      <div ref={listRef} role="listbox" aria-label="Browse route regions"
        className="max-h-[min(36dvh,20rem)] overflow-y-auto overscroll-contain px-1 pb-1"
        onKeyDown={(event) => {
          const items = options();
          const index = items.indexOf(document.activeElement as HTMLButtonElement);
          const next = event.key === "ArrowDown" ? Math.min(items.length - 1, index + 1)
            : event.key === "ArrowUp" ? Math.max(0, index - 1)
            : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : null;
          if (next !== null) { event.preventDefault(); items[next]?.focus(); }
        }}>
        {visible.map((region, index) => (
          <button key={region.name} type="button" role="option" aria-label={region.name}
            aria-selected={selectedRegion?.name === region.name}
            tabIndex={visible.some((item) => item.name === selectedRegion?.name) ? (selectedRegion?.name === region.name ? 0 : -1) : (index === 0 ? 0 : -1)}
            onClick={() => onSelect(region)}
            className="flex min-h-12 w-full items-center gap-3 rounded-[var(--radius-control)] px-3 py-2 text-left hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring aria-selected:bg-white/[0.08]">
            <MapPin className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
            <span className="min-w-0 flex-1 text-sm text-ink">{region.name}</span>
            <span className="shrink-0 text-xs text-ink-muted">{region.routes.length} {region.routes.length === 1 ? "route" : "routes"}</span>
            <span className="size-4 shrink-0">{selectedRegion?.name === region.name ? <Check className="size-4" aria-hidden="true" /> : null}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

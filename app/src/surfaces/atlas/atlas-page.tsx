import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useReducer,
} from "react";
import { MapPin } from "lucide-react";
import { Link, useLocation, useSearchParams } from "react-router-dom";

import {
  AtlasControls,
  AtlasActivityFilter,
  type AtlasActivityMode,
} from "@/surfaces/atlas/components/atlas-controls";
import {
  AtlasGlobe,
  type AtlasGlobeHandle,
} from "@/surfaces/atlas/components/atlas-globe";
import { RegionRouteCarousel } from "@/surfaces/atlas/components/region-route-carousel";
import { AtlasSearch } from "@/surfaces/atlas/components/atlas-search";
import { completedRoutes } from "@/data/routes";
import { buildRouteRegions, type RouteRegion } from "@/data/route-regions";
import {
  ATLAS_REGION_PRESENTATION_DEADLINE_MS,
  atlasRegionAwaitingWorld,
  initialAtlasPresentationState,
  isAtlasRegionPresented,
  reduceAtlasPresentation,
} from "@/surfaces/atlas/atlas-presentation-state";
import { resolveAtlasSelection } from "@/surfaces/atlas/atlas-selection";
import type { RouteSummary } from "@/domain/route";
import { replayPath } from "@/app/route-paths";

export function AtlasPage() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const searchParamsRef = useRef(searchParams);
  searchParamsRef.current = searchParams;
  const globeRef = useRef<AtlasGlobeHandle>(null);
  const activityParam = searchParams.get("activity");
  const mode: AtlasActivityMode =
    activityParam === "runs" || activityParam === "rides"
      ? activityParam
      : "all";
  const visibleRoutes = useMemo(
    () =>
      completedRoutes.filter((route) => {
        if (mode === "runs") return route.type === "Run";
        if (mode === "rides") return route.type === "Ride";
        return true;
      }),
    [mode],
  );
  const routeRegions = useMemo(
    () => buildRouteRegions(visibleRoutes),
    [visibleRoutes],
  );
  const selection = resolveAtlasSelection(searchParams, routeRegions);
  const { selectedRegion, selectedRoute } = selection;
  const [presentation, dispatchPresentation] = useReducer(
    reduceAtlasPresentation,
    selectedRegion?.name,
    initialAtlasPresentationState,
  );
  const presentedRoute = selectedRoute ?? selectedRegion?.routes[0];
  const query = searchParams.get("q") ?? "";

  const updateSearchParams = useCallback(
    function updateSearchParams(
      update: (next: URLSearchParams) => void,
      replace = false,
    ) {
      const next = new URLSearchParams(searchParamsRef.current);
      update(next);
      searchParamsRef.current = next;
      setSearchParams(next, { replace });
    },
    [setSearchParams],
  );

  useEffect(() => {
    if (!selection.invalidRegion && !selection.invalidRoute) return;
    updateSearchParams((next) => {
      if (selection.invalidRegion) next.delete("region");
      if (selection.invalidRegion || selection.invalidRoute)
        next.delete("route");
    }, true);
  }, [selection.invalidRegion, selection.invalidRoute, updateSearchParams]);

  useLayoutEffect(() => {
    dispatchPresentation({
      type: "selectionChanged",
      regionName: selectedRegion?.name,
    });
  }, [selectedRegion?.name]);

  // Route cards are bundled data; the world gets a bounded head start.
  const regionAwaitingWorld = atlasRegionAwaitingWorld(presentation);
  useEffect(() => {
    if (!regionAwaitingWorld) return;
    const timer = window.setTimeout(() => {
      dispatchPresentation({
        type: "presentationDeadlinePassed",
        regionName: regionAwaitingWorld,
      });
    }, ATLAS_REGION_PRESENTATION_DEADLINE_MS);
    return () => window.clearTimeout(timer);
  }, [regionAwaitingWorld]);

  // Without a globe to act on (still opening, or unavailable), the places
  // come from bundled data and stand in for it.
  const showPlaces =
    !selectedRegion &&
    (presentation.world === "opening" ||
      presentation.status.state === "unavailable");

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      const activeElement = document.activeElement;
      if (
        activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement ||
        activeElement instanceof HTMLSelectElement
      ) {
        return;
      }
      if (!selectedRegion) return;
      event.preventDefault();
      updateSearchParams((next) => {
        if (next.has("route")) next.delete("route");
        else next.delete("region");
      });
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [selectedRegion, updateSearchParams]);

  function selectRegion(region: RouteRegion) {
    updateSearchParams((next) => {
      next.set("region", region.name);
      next.delete("route");
    });
  }

  function selectRoute(route: RouteSummary) {
    updateSearchParams((next) => {
      next.set("region", route.region);
      next.set("route", route.slug);
    });
  }

  function replayPathForRoute(route: RouteSummary) {
    const returnParams = new URLSearchParams(searchParams);
    returnParams.set("region", route.region);
    returnParams.set("route", route.slug);
    return replayPath(
      route.slug,
      `${location.pathname}?${returnParams.toString()}`,
    );
  }

  function clearRegion() {
    updateSearchParams((next) => {
      next.delete("region");
      next.delete("route");
    });
  }

  function setQuery(value: string) {
    updateSearchParams((next) => {
      if (value !== query) {
        next.delete("route");
        if (!selectedRegion) next.delete("region");
      }
      if (value) next.set("q", value);
      else next.delete("q");
    }, true);
  }

  function setMode(nextMode: AtlasActivityMode) {
    updateSearchParams((next) => {
      next.delete("region");
      next.delete("route");
      if (nextMode === "all") next.delete("activity");
      else next.set("activity", nextMode);
    });
  }

  return (
    <section
      data-region-selected={Boolean(selectedRegion)}
      data-places-shown={showPlaces}
      className="atlas-layout relative isolate h-[calc(100dvh-var(--mobile-navigation-height))] min-h-0 overflow-hidden bg-background md:h-dvh"
    >
      <AtlasGlobe
        ref={globeRef}
        regions={routeRegions}
        selectedRegion={selectedRegion}
        selectedRoute={presentedRoute}
        onSelectRegion={selectRegion}
        onSelectRoute={selectRoute}
        presentation={presentation}
        onPresentationEvent={dispatchPresentation}
        className="absolute inset-0 min-h-0 rounded-none border-0"
      />

      <div className="atlas-discovery absolute z-30 grid gap-2">
        <AtlasSearch
          routes={visibleRoutes}
          regions={routeRegions}
          query={query}
          onQueryChange={setQuery}
          selectedRegion={selectedRegion}
          onSelectRegion={selectRegion}
          selectedRoute={selectedRoute}
          onSelectRoute={selectRoute}
        />
        <div className="flex flex-wrap items-center gap-2">
          <AtlasActivityFilter mode={mode} onModeChange={setMode} />
          {selectedRegion ? <Link aria-label="Return to global Atlas" to="/atlas" className="atlas-return inline-flex min-h-11 items-center rounded-md bg-surface px-3 text-sm text-ink-secondary focus-visible:outline-2 focus-visible:outline-ring">All places</Link> : null}
        </div>
      </div>
      {showPlaces ? (
        <div className="absolute inset-x-0 bottom-0 z-30">
          <AtlasPlaces regions={routeRegions} onSelectRegion={selectRegion} />
        </div>
      ) : (
        <AtlasControls
          onZoomIn={() => globeRef.current?.zoomIn()}
          onZoomOut={() => globeRef.current?.zoomOut()}
          onResetView={() => globeRef.current?.resetView()}
        />
      )}
      {selectedRegion ? (
        <div className="absolute inset-x-0 bottom-0 z-30">
          <RegionRouteCarousel
            region={selectedRegion}
            selectedRoute={selectedRoute}
            onClear={clearRegion}
            onSelectRoute={selectRoute}
            replayPathForRoute={replayPathForRoute}
            presentationReady={isAtlasRegionPresented(presentation, selectedRegion.name)}
          />
        </div>
      ) : null}
    </section>
  );
}

function AtlasPlaces({
  regions,
  onSelectRegion,
}: {
  regions: RouteRegion[];
  onSelectRegion: (region: RouteRegion) => void;
}) {
  const places = useMemo(
    () => [...regions].sort((a, b) => a.name.localeCompare(b.name)),
    [regions],
  );
  return (
    <section
      aria-label="Places with routes"
      className="atlas-route-carousel flex h-[var(--atlas-tray-height,12rem)] flex-col overflow-hidden text-white"
    >
      <header className="atlas-route-header flex shrink-0 items-center justify-between gap-2 px-3 sm:px-5">
        <h2 className="truncate text-sm font-medium tracking-[-0.01em]">Places</h2>
        <span className="shrink-0 font-mono text-xs text-white/60">
          {places.length} {places.length === 1 ? "place" : "places"}
        </span>
      </header>
      <ul className="grid min-h-0 flex-1 auto-rows-min grid-cols-1 gap-2 overflow-y-auto overscroll-contain px-3 pb-3 sm:grid-cols-2 sm:px-5 lg:grid-cols-3 xl:grid-cols-4">
        {places.map((region) => (
          <li key={region.name}>
            <button
              type="button"
              onClick={() => onSelectRegion(region)}
              className="flex min-h-11 w-full items-center gap-3 rounded-[var(--radius-control)] border border-white/12 px-3 text-left hover:bg-white/10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
            >
              <MapPin className="size-4 shrink-0 text-white/60" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-sm">{region.name}</span>
              <span className="shrink-0 text-xs text-white/60">
                {region.routes.length} {region.routes.length === 1 ? "route" : "routes"}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

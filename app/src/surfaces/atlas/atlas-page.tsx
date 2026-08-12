import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useSearchParams } from "react-router-dom";

import {
  AtlasControls,
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
import { resolveAtlasSelection } from "@/surfaces/atlas/atlas-selection";
import type { RouteSummary } from "@/domain/route";
import { replayPath } from "@/app/route-paths";
import {
  atlasLensFromSearchParams,
  deriveTerrainReading,
  latestRecordedRegion,
  shouldOpenLatestRegion,
  type AtlasLens,
} from "@/surfaces/atlas/atlas-regional-view";

export function AtlasPage() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const searchParamsRef = useRef(searchParams);
  searchParamsRef.current = searchParams;
  const globeRef = useRef<AtlasGlobeHandle>(null);
  const [regionPresentationReady, setRegionPresentationReady] = useState(false);
  const activityParam = searchParams.get("activity");
  const mode: AtlasActivityMode =
    activityParam === "runs" || activityParam === "rides" ? activityParam : "all";
  const visibleRoutes = useMemo(
    () =>
      completedRoutes.filter((route) => {
        if (mode === "runs") return route.type === "Run";
        if (mode === "rides") return route.type === "Ride";
        return true;
      }),
    [mode],
  );
  const routeRegions = useMemo(() => buildRouteRegions(visibleRoutes), [visibleRoutes]);
  const latestRegion = useMemo(() => latestRecordedRegion(routeRegions), [routeRegions]);
  const selection = resolveAtlasSelection(searchParams, routeRegions);
  const { selectedRegion, selectedRoute } = selection;
  const presentedRoute = selectedRoute ?? selectedRegion?.routes[0];
  const query = searchParams.get("q") ?? "";
  const lens = atlasLensFromSearchParams(searchParams);
  const terrainReading = useMemo(
    () => (selectedRegion ? deriveTerrainReading(selectedRegion) : null),
    [selectedRegion],
  );

  const updateSearchParams = useCallback(function updateSearchParams(
    update: (next: URLSearchParams) => void,
    replace = false,
  ) {
    const next = new URLSearchParams(searchParamsRef.current);
    update(next);
    searchParamsRef.current = next;
    setSearchParams(next, { replace });
  }, [setSearchParams]);

  useEffect(() => {
    if (!selection.invalidRegion && !selection.invalidRoute) return;
    updateSearchParams((next) => {
      if (selection.invalidRegion) {
        next.delete("region");
        next.delete("lens");
        next.set("view", "world");
      }
      if (selection.invalidRegion || selection.invalidRoute) next.delete("route");
    }, true);
  }, [selection.invalidRegion, selection.invalidRoute, updateSearchParams]);

  useEffect(() => {
    if (!latestRegion || !shouldOpenLatestRegion(searchParams)) return;
    updateSearchParams((next) => next.set("region", latestRegion.name), true);
  }, [latestRegion, searchParams, updateSearchParams]);

  useLayoutEffect(() => {
    setRegionPresentationReady(false);
  }, [selectedRegion?.name]);

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
        else {
          next.delete("region");
          next.delete("lens");
          next.set("view", "world");
        }
      });
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [selectedRegion, updateSearchParams]);

  function selectRegion(region: RouteRegion) {
    setRegionPresentationReady(false);
    updateSearchParams((next) => {
      next.set("region", region.name);
      next.delete("route");
      next.delete("view");
    });
  }

  function selectRoute(route: RouteSummary) {
    updateSearchParams((next) => {
      next.set("region", route.region);
      next.set("route", route.slug);
      next.delete("view");
    });
  }

  function replayPathForRoute(route: RouteSummary) {
    const returnParams = new URLSearchParams(searchParams);
    returnParams.set("region", route.region);
    returnParams.set("route", route.slug);
    return replayPath(route.slug, `${location.pathname}?${returnParams.toString()}`);
  }

  function clearRegion() {
    setRegionPresentationReady(false);
    updateSearchParams((next) => {
      next.delete("region");
      next.delete("route");
      next.delete("lens");
      next.set("view", "world");
    });
  }

  function setLens(nextLens: AtlasLens) {
    updateSearchParams((next) => {
      if (nextLens === "terrain") next.set("lens", "terrain");
      else next.delete("lens");
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
      next.delete("lens");
      next.set("view", "world");
      if (nextMode === "all") next.delete("activity");
      else next.set("activity", nextMode);
    });
  }

  return (
    <section className="relative isolate h-[calc(100dvh-var(--mobile-navigation-height))] min-h-0 overflow-hidden bg-background md:h-dvh">
      <AtlasGlobe
        ref={globeRef}
        regions={routeRegions}
        selectedRegion={selectedRegion}
        selectedRoute={presentedRoute}
        onSelectRegion={selectRegion}
        onSelectRoute={selectRoute}
        onRegionPresentationReady={setRegionPresentationReady}
        routeDisplayMode={lens === "terrain" ? "terrain" : "standard"}
        className="absolute inset-0 min-h-0 rounded-none border-0"
      />

      <AtlasSearch
        routes={visibleRoutes}
        regions={routeRegions}
        query={query}
        onQueryChange={setQuery}
        selectedRegion={selectedRegion}
        onSelectRegion={selectRegion}
        selectedRoute={selectedRoute}
        onSelectRoute={selectRoute}
        className={`atlas-search-panel absolute left-4 right-4 top-20 z-30 max-h-[56dvh] overflow-y-auto md:left-[15.5rem] md:right-5 md:top-[5.25rem] md:min-h-[54px] md:p-1 xl:left-[26.5rem] xl:right-auto xl:top-5 xl:w-[340px] ${selectedRegion ? "atlas-search-panel--selected [@media(max-height:600px)]:hidden" : ""}`}
      />
      <AtlasControls
        regions={routeRegions}
        selectedRegion={selectedRegion}
        onSelectRegion={selectRegion}
        mode={mode}
        onModeChange={setMode}
        onZoomIn={() => globeRef.current?.zoomIn()}
        onZoomOut={() => globeRef.current?.zoomOut()}
        onResetView={() => globeRef.current?.resetView()}
      />
      {selectedRegion ? (
        <div className="absolute inset-x-0 bottom-0 z-30">
          <RegionRouteCarousel
            region={selectedRegion}
            selectedRoute={selectedRoute}
            onClear={clearRegion}
            onSelectRoute={selectRoute}
            replayPathForRoute={replayPathForRoute}
            presentationReady={regionPresentationReady}
            lens={lens}
            onLensChange={setLens}
          />
        </div>
      ) : null}
      {selectedRegion && lens === "terrain" && terrainReading ? (
        <aside
          role="region"
          aria-label={`${selectedRegion.name} terrain reading`}
          className="absolute bottom-[27rem] right-3 z-30 w-[min(22rem,calc(100%-1.5rem))] border border-white/30 bg-[#f6f2e8]/94 px-4 py-3 text-[#24322d] shadow-lg backdrop-blur md:bottom-[23.75rem] md:right-5 [@media(max-height:650px)]:hidden"
        >
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-editorial text-lg font-semibold">Terrain reading</p>
            <p className="text-[10px] font-semibold uppercase text-[#315fb4]">Derived from recorded tracks</p>
          </div>
          <dl className="mt-2 grid grid-cols-3 divide-x divide-[#c7c1b5]">
            {[
              ["High point", terrainReading.highPointM],
              ["Relief", terrainReading.reliefM],
              ["Climbed", terrainReading.recordedClimbM],
            ].map(([label, value], index) => (
              <div key={String(label)} className={index === 0 ? "pr-3" : index === 2 ? "pl-3" : "px-3"}>
                <dt className="text-[10px] uppercase text-[#5d6a64]">{label}</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums">
                  {Math.round(Number(value)).toLocaleString()} m
                </dd>
              </div>
            ))}
          </dl>
        </aside>
      ) : null}
    </section>
  );
}

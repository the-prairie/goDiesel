import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ArrowRight } from "lucide-react";
import { useLocation, useSearchParams } from "react-router-dom";

import { AtlasImmersiveNavigation } from "@/components/atlas-immersive-navigation";
import {
  AtlasControls,
  type AtlasActivityMode,
} from "@/components/globe/atlas-controls";
import {
  AtlasGlobe,
  type AtlasGlobeHandle,
} from "@/components/globe/atlas-globe";
import { RegionRouteCarousel } from "@/components/globe/region-route-carousel";
import { AtlasSearch } from "@/components/search/atlas-search";
import { Button } from "@/components/ui/button";
import { completedRoutes } from "@/data/routes";
import { buildRouteRegions, type RouteRegion } from "@/data/route-regions";
import { resolveAtlasSelection } from "@/domain/atlas-selection";
import type { RouteSummary } from "@/domain/routes";
import { replayPath } from "@/navigation";

export function AtlasPage() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const searchParamsRef = useRef(searchParams);
  searchParamsRef.current = searchParams;
  const globeRef = useRef<AtlasGlobeHandle>(null);
  const [regionPresentationReady, setRegionPresentationReady] = useState(false);
  const [searchOpen, setSearchOpen] = useState(
    () => searchParams.get("q") !== null,
  );
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
  const selection = resolveAtlasSelection(searchParams, routeRegions);
  const { selectedRegion, selectedRoute } = selection;
  const presentedRoute = selectedRoute ?? selectedRegion?.routes[0];
  const query = searchParams.get("q") ?? "";

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
      if (selection.invalidRegion) next.delete("region");
      if (selection.invalidRegion || selection.invalidRoute) next.delete("route");
    }, true);
  }, [selection.invalidRegion, selection.invalidRoute, updateSearchParams]);

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
        else next.delete("region");
      });
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [selectedRegion, updateSearchParams]);

  function selectRegion(region: RouteRegion) {
    setRegionPresentationReady(false);
    setSearchOpen(false);
    updateSearchParams((next) => {
      next.set("region", region.name);
      next.delete("route");
      next.delete("q");
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
    return replayPath(route.slug, `${location.pathname}?${returnParams.toString()}`);
  }

  function clearRegion() {
    setRegionPresentationReady(false);
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

  const totalDistanceKm = visibleRoutes.reduce(
    (total, route) => total + route.distanceKm,
    0,
  );
  const featuredRegion = routeRegions[0];

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
        className="absolute inset-0 min-h-0 rounded-none border-0"
      />

      <AtlasImmersiveNavigation
        selectedRegion={selectedRegion}
        onReturnToWorld={clearRegion}
        onOpenSearch={() => setSearchOpen(true)}
      />

      {searchOpen ? (
        <AtlasSearch
          routes={visibleRoutes}
          regions={routeRegions}
          query={query}
          onQueryChange={setQuery}
          selectedRegion={selectedRegion}
          onSelectRegion={selectRegion}
          selectedRoute={selectedRoute}
          onSelectRoute={selectRoute}
          mode={mode}
          onModeChange={setMode}
          onClose={() => {
            setSearchOpen(false);
            setQuery("");
          }}
          className="atlas-search-panel absolute left-3 right-3 top-[5.25rem] z-30 max-h-[calc(100dvh-7rem)] overflow-y-auto sm:left-auto sm:right-5 sm:w-[24rem]"
        />
      ) : null}

      <AtlasControls
        selectedRegion={Boolean(selectedRegion)}
        onZoomIn={() => globeRef.current?.zoomIn()}
        onZoomOut={() => globeRef.current?.zoomOut()}
        onResetView={() => globeRef.current?.resetView()}
      />

      {!selectedRegion ? (
        <>
          <p className="pointer-events-none absolute bottom-5 left-3 z-20 hidden text-sm tabular-nums text-white/68 sm:left-5 md:block">
            {visibleRoutes.length} journeys · {routeRegions.length} places ·{" "}
            {totalDistanceKm.toFixed(0)} km
          </p>
          {featuredRegion ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => selectRegion(featuredRegion)}
              className="absolute bottom-5 left-1/2 z-20 hidden h-11 -translate-x-1/2 gap-3 rounded-sm border-b border-white/65 px-3 text-base font-normal text-white hover:bg-white/8 hover:text-white sm:inline-flex"
            >
              Explore {featuredRegion.name.replace(/,.*/, "")}
              <ArrowRight aria-hidden="true" />
            </Button>
          ) : null}
        </>
      ) : null}

      {selectedRegion ? (
        <div className="absolute inset-x-0 bottom-0 top-[4.5rem] z-30 flex items-end overflow-hidden">
          <RegionRouteCarousel
            region={selectedRegion}
            selectedRoute={selectedRoute}
            onClear={clearRegion}
            onSelectRoute={selectRoute}
            replayPathForRoute={replayPathForRoute}
            presentationReady={regionPresentationReady}
          />
        </div>
      ) : null}
    </section>
  );
}

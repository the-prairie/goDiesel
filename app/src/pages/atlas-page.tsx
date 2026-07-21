import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";

import {
  AtlasControls,
  type AtlasActivityMode,
} from "@/components/globe/atlas-controls";
import {
  AtlasGlobe,
  type AtlasGlobeHandle,
} from "@/components/globe/atlas-globe";
import {
  RegionInspector,
  type MobileSheetPosition,
} from "@/components/globe/region-inspector";
import { AtlasSearch } from "@/components/search/atlas-search";
import { completedRoutes } from "@/data/routes";
import { buildRouteRegions, type RouteRegion } from "@/data/route-regions";
import { resolveAtlasSelection } from "@/domain/atlas-selection";
import type { RouteSummary } from "@/domain/routes";
import { replayPath } from "@/navigation";

export function AtlasPage() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const globeRef = useRef<AtlasGlobeHandle>(null);
  const [mobileSheetPosition, setMobileSheetPosition] =
    useState<MobileSheetPosition>(() =>
      window.innerHeight <= 600 ? "peek" : "half",
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
  const query = searchParams.get("q") ?? "";
  const atlasPath = `${location.pathname}${location.search}`;

  const updateSearchParams = useCallback(function updateSearchParams(
    update: (next: URLSearchParams) => void,
    replace = false,
  ) {
    const next = new URLSearchParams(searchParams);
    update(next);
    setSearchParams(next, { replace });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (!selection.invalidRegion && !selection.invalidRoute) return;
    updateSearchParams((next) => {
      if (selection.invalidRegion) next.delete("region");
      if (selection.invalidRegion || selection.invalidRoute) next.delete("route");
    }, true);
  }, [selection.invalidRegion, selection.invalidRoute, updateSearchParams]);

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
      if (!selectedRoute && !selectedRegion) return;
      event.preventDefault();
      updateSearchParams((next) => {
        if (selectedRoute) next.delete("route");
        else next.delete("region");
      });
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [selectedRegion, selectedRoute, updateSearchParams]);

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

  function clearRegion() {
    updateSearchParams((next) => {
      next.delete("region");
      next.delete("route");
    });
  }

  function setQuery(value: string) {
    updateSearchParams((next) => {
      if (value !== query) {
        next.delete("region");
        next.delete("route");
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
    <section className="relative isolate h-[calc(100dvh-var(--mobile-navigation-height))] min-h-0 overflow-hidden bg-background md:h-dvh">
      <AtlasGlobe
        ref={globeRef}
        regions={routeRegions}
        selectedRegion={selectedRegion}
        onSelectRegion={selectRegion}
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
        className={`atlas-search-panel absolute left-4 right-4 top-20 z-30 max-h-[56dvh] overflow-y-auto xl:left-[15.5rem] xl:right-auto xl:top-5 xl:h-[54px] xl:w-[340px] xl:p-1 ${selectedRegion ? "atlas-search-panel--selected" : ""}`}
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
      <RegionInspector
        selectedRegion={selectedRegion}
        selectedRoute={selectedRoute}
        onClear={clearRegion}
        onSelectRoute={selectRoute}
        replayPathForRoute={(route) => replayPath(route.slug, atlasPath)}
        mobilePosition={mobileSheetPosition}
        onMobilePositionChange={setMobileSheetPosition}
      />
    </section>
  );
}

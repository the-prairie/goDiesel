import { useEffect, useMemo, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import {
  AtlasControls,
  type AtlasActivityMode,
} from "@/components/globe/atlas-controls";
import {
  AtlasGlobe,
  type AtlasGlobeHandle,
} from "@/components/globe/atlas-globe";
import { RegionInspector } from "@/components/globe/region-inspector";
import { AtlasSearch } from "@/components/search/atlas-search";
import { completedRoutes } from "@/data/routes";
import { buildRouteRegions, type RouteRegion } from "@/data/route-regions";
import type { RouteSummary } from "@/domain/routes";
import { routeDetailPath } from "@/navigation";

export function AtlasPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const globeRef = useRef<AtlasGlobeHandle>(null);
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
  const regionParam = searchParams.get("region");
  const selectedRegion = routeRegions.find((region) => region.name === regionParam);
  const query = searchParams.get("q") ?? "";
  const openRoute = (route: RouteSummary) => navigate(routeDetailPath(route.slug));

  useEffect(() => {
    if (!regionParam || selectedRegion) return;
    const next = new URLSearchParams(searchParams);
    next.delete("region");
    setSearchParams(next, { replace: true });
  }, [regionParam, searchParams, selectedRegion, setSearchParams]);

  function updateSearchParams(
    update: (next: URLSearchParams) => void,
    replace = false,
  ) {
    const next = new URLSearchParams(searchParams);
    update(next);
    setSearchParams(next, { replace });
  }

  function selectRegion(region: RouteRegion) {
    updateSearchParams((next) => next.set("region", region.name));
  }

  function clearRegion() {
    updateSearchParams((next) => next.delete("region"));
  }

  function setQuery(value: string) {
    updateSearchParams((next) => {
      if (value !== query) next.delete("region");
      if (value) next.set("q", value);
      else next.delete("q");
    }, true);
  }

  function setMode(nextMode: AtlasActivityMode) {
    updateSearchParams((next) => {
      next.delete("region");
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
        onOpenRoute={openRoute}
        className="absolute inset-0 min-h-0 rounded-none border-0"
      />

      <AtlasSearch
        routes={visibleRoutes}
        regions={routeRegions}
        query={query}
        onQueryChange={setQuery}
        selectedRegion={selectedRegion}
        onSelectRegion={selectRegion}
        onOpenRoute={openRoute}
        className={`atlas-search-panel absolute left-4 right-4 top-20 z-30 max-h-[56dvh] overflow-y-auto xl:left-[17rem] xl:right-auto xl:top-5 xl:w-[340px] ${selectedRegion ? "atlas-search-panel--selected" : ""}`}
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
        onClear={clearRegion}
        onOpenRoute={openRoute}
      />
    </section>
  );
}

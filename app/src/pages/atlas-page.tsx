import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { AtlasControls } from "@/components/globe/atlas-controls";
import { AtlasGlobe } from "@/components/globe/atlas-globe";
import { RegionInspector } from "@/components/globe/region-inspector";
import { AtlasSearch } from "@/components/search/atlas-search";
import { completedRoutes } from "@/data/routes";
import { routeRegions, type RouteRegion } from "@/data/route-regions";
import type { RouteSummary } from "@/domain/routes";
import { routeDetailPath } from "@/navigation";

export function AtlasPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
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

  return (
    <section className="relative isolate min-h-[calc(100dvh-var(--mobile-navigation-height))] overflow-hidden bg-[#0c1210] md:min-h-dvh">
      <AtlasGlobe
        regions={routeRegions}
        selectedRegion={selectedRegion}
        onSelectRegion={selectRegion}
        onOpenRoute={openRoute}
        className="absolute inset-0 min-h-0 rounded-none border-0"
      />

      {/* Quiet place label — no floating intro card */}
      <div className="pointer-events-none absolute left-[var(--mobile-edge)] top-[var(--mobile-edge)] z-[var(--z-map-controls)] sm:left-[var(--space-map-edge)] sm:top-[var(--space-map-edge)]">
        <p className="text-place-label text-[1.125rem] text-white/90 drop-shadow-sm sm:text-[1.375rem]">
          Atlas
        </p>
      </div>

      <AtlasSearch
        routes={completedRoutes}
        regions={routeRegions}
        query={query}
        onQueryChange={setQuery}
        selectedRegion={selectedRegion}
        onSelectRegion={selectRegion}
        onOpenRoute={openRoute}
        className="atlas-search-panel absolute inset-x-3 top-14 z-[var(--z-inspector)] max-h-[48dvh] overflow-y-auto rounded-[var(--radius-panel)] border border-line bg-surface/94 p-3 shadow-[var(--shadow-panel)] backdrop-blur-sm sm:inset-x-auto sm:left-auto sm:right-[var(--space-map-edge)] sm:top-[var(--space-map-edge)] sm:w-[22.5rem]"
      />
      <AtlasControls
        regions={routeRegions}
        selectedRegion={selectedRegion}
        onSelectRegion={selectRegion}
      />
      <RegionInspector
        selectedRegion={selectedRegion}
        onClear={clearRegion}
        onOpenRoute={openRoute}
      />
    </section>
  );
}

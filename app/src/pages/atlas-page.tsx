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
    <section className="relative isolate min-h-[calc(100dvh-3.5rem)] overflow-hidden bg-background">
      <AtlasGlobe
        regions={routeRegions}
        selectedRegion={selectedRegion}
        onSelectRegion={selectRegion}
        onOpenRoute={openRoute}
        className="absolute inset-0 min-h-0 rounded-none border-0"
      />

      <div className="pointer-events-none absolute left-3 top-3 z-20 max-w-[min(30rem,calc(100%-1.5rem))] sm:left-5 sm:top-5">
        <div className="text-xs font-semibold uppercase text-primary">Atlas</div>
        <h1 className="mt-1 text-2xl font-bold text-foreground drop-shadow-lg sm:text-4xl">
          Real places, playable days.
        </h1>
        <p className="mt-2 hidden max-w-md text-sm leading-6 text-foreground/70 drop-shadow sm:block">
          Completed runs and rides, mapped as memories you can enter again.
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
        className="absolute inset-x-3 top-20 z-30 max-h-[56dvh] overflow-y-auto sm:inset-x-5 sm:top-36 lg:left-auto lg:right-5 lg:top-5 lg:w-[360px]"
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

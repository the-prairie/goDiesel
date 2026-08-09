import type { RouteRegion } from "@/data/route-regions";
import type { RouteSummary } from "@/domain/route";

export interface AtlasSelection {
  selectedRegion?: RouteRegion;
  selectedRoute?: RouteSummary;
  invalidRegion: boolean;
  invalidRoute: boolean;
}

export function resolveAtlasSelection(
  searchParams: URLSearchParams,
  regions: RouteRegion[],
): AtlasSelection {
  const regionParam = searchParams.get("region");
  const routeParam = searchParams.get("route");
  const selectedRegion = regions.find((region) => region.name === regionParam);
  const selectedRoute = selectedRegion?.routes.find(
    (route) => route.slug === routeParam,
  );

  return {
    selectedRegion,
    selectedRoute,
    invalidRegion: Boolean(regionParam && !selectedRegion),
    invalidRoute: Boolean(routeParam && !selectedRoute),
  };
}

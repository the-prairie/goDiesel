import type { RouteLifecycle } from "@/domain/route/lifecycle";
import type { RouteSummary } from "@/domain/route";

export interface RouteFilters {
  query: string;
  lifecycle: "all" | RouteLifecycle;
  activity: "all" | string;
  region: "all" | string;
  distance: "all" | "under-10" | "10-20" | "20-50" | "50-plus";
  climb: "all" | "under-250" | "250-750" | "750-plus";
  vibe: "all" | string;
}

export const DEFAULT_ROUTE_FILTERS: RouteFilters = {
  query: "",
  lifecycle: "all",
  activity: "all",
  region: "all",
  distance: "all",
  climb: "all",
  vibe: "all",
};

export function filterRoutes(
  routes: readonly RouteSummary[],
  filters: RouteFilters,
): RouteSummary[] {
  const query = filters.query.trim().toLowerCase();

  return routes.filter((route) => {
    if (query && !routeMatchesQuery(route, query)) return false;
    if (filters.lifecycle !== "all" && route.lifecycle !== filters.lifecycle) return false;
    if (filters.activity !== "all" && route.type !== filters.activity) return false;
    if (filters.region !== "all" && route.region !== filters.region) return false;
    if (!routeMatchesDistance(route.distanceKm, filters.distance)) return false;
    if (!routeMatchesClimb(route.elevationGainM, filters.climb)) return false;
    if (filters.vibe !== "all" && route.theme !== filters.vibe) return false;
    return true;
  });
}

function routeMatchesQuery(route: RouteSummary, query: string) {
  return [
    route.name,
    route.region,
    route.subtitle,
    route.activityName,
    route.description,
    route.theme,
    route.guide?.vibe,
  ].some((value) => value?.toLowerCase().includes(query));
}

function routeMatchesDistance(distanceKm: number, filter: RouteFilters["distance"]) {
  switch (filter) {
    case "all":
      return true;
    case "under-10":
      return distanceKm < 10;
    case "10-20":
      return distanceKm >= 10 && distanceKm < 20;
    case "20-50":
      return distanceKm >= 20 && distanceKm < 50;
    case "50-plus":
      return distanceKm >= 50;
  }
}

function routeMatchesClimb(elevationGainM: number, filter: RouteFilters["climb"]) {
  switch (filter) {
    case "all":
      return true;
    case "under-250":
      return elevationGainM < 250;
    case "250-750":
      return elevationGainM >= 250 && elevationGainM < 750;
    case "750-plus":
      return elevationGainM >= 750;
  }
}

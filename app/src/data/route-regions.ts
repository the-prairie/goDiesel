import { completedRoutes } from "@/data/routes";
import type { RouteSummary } from "@/domain/routes";

export interface RouteRegion {
  name: string;
  routes: RouteSummary[];
  totalKm: number;
  totalClimbM: number;
  centerLat: number;
  centerLng: number;
}

export function buildRouteRegions(routes: RouteSummary[]): RouteRegion[] {
  return Object.values(
    routes.reduce<Record<string, RouteRegion>>((regions, route) => {
      const current =
        regions[route.region] ??
        (regions[route.region] = {
          name: route.region,
          routes: [],
          totalKm: 0,
          totalClimbM: 0,
          centerLat: 0,
          centerLng: 0,
        });

      current.routes.push(route);
      current.totalKm += route.distanceKm;
      current.totalClimbM += route.elevationGainM;
      current.centerLat += route.centerLat;
      current.centerLng += route.centerLng;

      return regions;
    }, {}),
  )
    .map((region) => ({
      ...region,
      centerLat: region.centerLat / region.routes.length,
      centerLng: region.centerLng / region.routes.length,
    }))
    .sort(
      (a, b) => b.routes.length - a.routes.length || a.name.localeCompare(b.name),
    );
}

export const routeRegions = buildRouteRegions(completedRoutes);

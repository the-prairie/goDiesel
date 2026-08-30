import { completedRoutes } from "@/data/routes";
import {
  deriveGeographicBounds,
  type GeographicBounds,
} from "@/domain/geometry/geographic-bounds";
import type { RouteSummary } from "@/domain/route";

export interface RouteRegion {
  name: string;
  routes: RouteSummary[];
  totalKm: number;
  totalClimbM: number;
  bounds: GeographicBounds | null;
  centerLat: number;
  centerLng: number;
}

type RouteRegionAccumulator = Omit<
  RouteRegion,
  "bounds" | "centerLat" | "centerLng"
>;

export function buildRouteRegions(routes: RouteSummary[]): RouteRegion[] {
  return Object.values(
    routes.reduce<Record<string, RouteRegionAccumulator>>((regions, route) => {
      const current =
        regions[route.region] ??
        (regions[route.region] = {
          name: route.region,
          routes: [],
          totalKm: 0,
          totalClimbM: 0,
        });

      current.routes.push(route);
      current.totalKm += route.distanceKm;
      current.totalClimbM += route.elevationGainM ?? 0;

      return regions;
    }, {}),
  )
    .map((region) => {
      const bounds = deriveGeographicBounds(region.routes);

      return {
        ...region,
        bounds,
        centerLat: bounds?.centerLat ?? 0,
        centerLng: bounds?.centerLng ?? 0,
      };
    })
    .sort(
      (a, b) => b.routes.length - a.routes.length || a.name.localeCompare(b.name),
    );
}

export const routeRegions = buildRouteRegions(completedRoutes);

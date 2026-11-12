import { deriveGeographicBounds } from "@/domain/geometry/geographic-bounds";
import { isCompletedRoute } from "@/domain/route/lifecycle";
import type { RouteSummary } from "@/domain/route";

/**
 * The pixel world map: an equirectangular crop from 130°W to 145°E and
 * 60°N to 12°S at four pixels per degree, the extent of her places.
 */
export const WORLD_MAP = {
  width: 1100,
  height: 288,
  west: -130,
  east: 145,
  north: 60,
  south: -12,
  pixelsPerDegree: 4,
} as const;

/** One of her places, drawn as a town on the world map. */
export interface OverlandTown {
  /** The region label, exactly as the route data names it. */
  name: string;
  lat: number;
  lng: number;
  /** Position on the world map, in map pixels. */
  x: number;
  y: number;
  routeCount: number;
  km: number;
  slugs: string[];
}

export function projectToWorldMap(lat: number, lng: number) {
  return {
    x: (lng - WORLD_MAP.west) * WORLD_MAP.pixelsPerDegree,
    y: (WORLD_MAP.north - lat) * WORLD_MAP.pixelsPerDegree,
  };
}

function townCentre(routes: readonly RouteSummary[]) {
  const bounds = deriveGeographicBounds(routes);
  if (bounds) return { lat: bounds.centerLat, lng: bounds.centerLng };
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    lat: mean(routes.map((route) => route.centerLat)),
    lng: mean(routes.map((route) => route.centerLng)),
  };
}

export function buildOverlandTowns(routes: readonly RouteSummary[]): OverlandTown[] {
  const byPlace = new Map<string, RouteSummary[]>();
  for (const route of routes.filter(isCompletedRoute)) {
    const place = byPlace.get(route.region);
    if (place) place.push(route);
    else byPlace.set(route.region, [route]);
  }

  return [...byPlace]
    .map(([name, placeRoutes]) => {
      const { lat, lng } = townCentre(placeRoutes);
      return {
        name,
        lat,
        lng,
        ...projectToWorldMap(lat, lng),
        routeCount: placeRoutes.length,
        km: placeRoutes.reduce((sum, route) => sum + route.distanceKm, 0),
        slugs: placeRoutes.map((route) => route.slug),
      };
    })
    .sort((a, b) => a.lng - b.lng || a.name.localeCompare(b.name));
}

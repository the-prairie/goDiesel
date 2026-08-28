import type { RouteSummary } from "@/domain/route";

export interface GeographicBounds {
  south: number;
  north: number;
  west: number;
  east: number;
  centerLat: number;
  centerLng: number;
  longitudeSpan: number;
  crossesAntimeridian: boolean;
}

export function deriveGeographicBounds(
  routes: readonly RouteSummary[],
): GeographicBounds | null {
  const latitudes: number[] = [];
  const longitudes: number[] = [];

  for (const route of routes) {
    if (route.replay.geometryStatus !== "ready") continue;

    for (const point of route.trace) {
      if (!isValidCoordinate(point.lat, point.lng)) continue;
      latitudes.push(point.lat);
      longitudes.push(normalizeLongitude360(point.lng));
    }
  }

  if (latitudes.length === 0) return null;

  const south = Math.min(...latitudes);
  const north = Math.max(...latitudes);
  const { west, east } = minimalLongitudeArc(longitudes);

  return {
    south,
    north,
    west,
    east,
    centerLat: (south + north) / 2,
    centerLng: normalizeLongitude(west + (east - west) / 2),
    longitudeSpan: east - west,
    crossesAntimeridian: east > 180,
  };
}

export function isValidCoordinate(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

function minimalLongitudeArc(longitudes: number[]): {
  west: number;
  east: number;
} {
  const sorted = [...longitudes].sort((a, b) => a - b);
  let largestGap = -1;
  let largestGapIndex = 0;

  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index];
    const next =
      sorted[(index + 1) % sorted.length] +
      (index === sorted.length - 1 ? 360 : 0);
    const gap = next - current;

    if (gap > largestGap) {
      largestGap = gap;
      largestGapIndex = index;
    }
  }

  const arcStart = sorted[(largestGapIndex + 1) % sorted.length];
  const arcEnd =
    sorted[largestGapIndex] + (largestGapIndex < sorted.length - 1 ? 360 : 0);
  const west = normalizeLongitude(arcStart);

  return { west, east: west + (arcEnd - arcStart) };
}

function normalizeLongitude360(longitude: number): number {
  return ((longitude % 360) + 360) % 360;
}

function normalizeLongitude(longitude: number): number {
  return ((((longitude + 180) % 360) + 360) % 360) - 180;
}

import type { RoutePoint } from "@/domain/routes";

export interface ProjectedRoutePoint {
  point: RoutePoint;
  x: number;
  y: number;
}

export function projectRouteGeometry(points: RoutePoint[]): ProjectedRoutePoint[] {
  if (points.length === 0) return [];
  const meanLatitudeRadians =
    (points.reduce((total, point) => total + point.lat, 0) / points.length) *
    (Math.PI / 180);
  const longitudeScale = Math.max(0.01, Math.cos(meanLatitudeRadians));
  let previousLongitude = points[0].lng;
  let longitudeOffset = 0;

  return points.map((point, index) => {
    if (index > 0) {
      const delta = point.lng - previousLongitude;
      if (delta > 180) longitudeOffset -= 360;
      if (delta < -180) longitudeOffset += 360;
      previousLongitude = point.lng;
    }
    return {
      point,
      x: (point.lng + longitudeOffset) * longitudeScale,
      y: point.lat,
    };
  });
}

export function sampleRoutePoints(points: RoutePoint[], maximum = 240) {
  if (points.length <= maximum) return points;
  const step = (points.length - 1) / (maximum - 1);
  return Array.from({ length: maximum }, (_, index) =>
    points[Math.min(points.length - 1, Math.round(index * step))],
  );
}

export function sampleElevationProfile(points: RoutePoint[], maximum = 240) {
  if (points.length <= maximum) return points;
  const interior = points.slice(1, -1);
  const bucketCount = Math.max(1, Math.floor((maximum - 2) / 2));
  const bucketSize = interior.length / bucketCount;
  const sampled: RoutePoint[] = [points[0]];

  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const start = Math.floor(bucket * bucketSize);
    const end = Math.max(start + 1, Math.floor((bucket + 1) * bucketSize));
    const entries = interior.slice(start, end);
    if (entries.length === 0) continue;
    const minimum = entries.reduce((current, point) =>
      point.elev < current.elev ? point : current,
    );
    const maximumPoint = entries.reduce((current, point) =>
      point.elev > current.elev ? point : current,
    );
    if (minimum.d <= maximumPoint.d) {
      sampled.push(minimum);
      if (maximumPoint !== minimum) sampled.push(maximumPoint);
    } else {
      sampled.push(maximumPoint, minimum);
    }
  }

  sampled.push(points.at(-1)!);
  return sampled;
}

export function elevationRange(points: RoutePoint[]) {
  const elevations = points.map((point) => point.elev);
  return {
    minimum: Math.min(...elevations),
    maximum: Math.max(...elevations),
  };
}

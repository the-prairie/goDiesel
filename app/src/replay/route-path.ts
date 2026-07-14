import type { QuestRoute, RoutePoint } from "@/domain/routes";

export interface RoutePathPose {
  lat: number;
  lng: number;
  elev: number;
  bearingDeg: number;
  progressM: number;
  progressRatio: number;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function routeDistanceM(route: QuestRoute) {
  return Math.max(route.distanceKm * 1_000, route.route.at(-1)?.d ?? 0, 1);
}

function pointAtDistance(points: RoutePoint[], progressM: number) {
  if (points.length === 1) return { point: points[0], next: points[0] };
  let upper = points.findIndex((point) => point.d >= progressM);
  if (upper <= 0) upper = 1;
  if (upper < 0) upper = points.length - 1;
  const start = points[upper - 1];
  const end = points[upper];
  const span = Math.max(1, end.d - start.d);
  const ratio = clamp((progressM - start.d) / span, 0, 1);
  return {
    point: {
      lat: start.lat + (end.lat - start.lat) * ratio,
      lng: start.lng + (end.lng - start.lng) * ratio,
      elev: start.elev + (end.elev - start.elev) * ratio,
      d: progressM,
    },
    next: end,
  };
}

function bearingDegrees(from: RoutePoint, to: RoutePoint) {
  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;
  const deltaLng = ((to.lng - from.lng) * Math.PI) / 180;
  const y = Math.sin(deltaLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function routePathPose(route: QuestRoute, progressM: number): RoutePathPose {
  const totalDistanceM = routeDistanceM(route);
  const boundedProgressM = clamp(progressM, 0, totalDistanceM);
  const { point, next } = pointAtDistance(route.route, boundedProgressM);
  return {
    lat: point.lat,
    lng: point.lng,
    elev: point.elev,
    bearingDeg: bearingDegrees(point, next),
    progressM: boundedProgressM,
    progressRatio: boundedProgressM / totalDistanceM,
  };
}

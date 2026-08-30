import type { PlannedRoute } from "@/domain/planning";
import type { RouteSummary } from "@/domain/route";
import { placesOverlap } from "@/domain/place-match";

const MAX_SAMPLE_POINTS = 48;
const NEARBY_TRACE_KM = 1.5;
const MIN_OVERLAP_RATIO = 0.55;

export interface RecordedPlanMatch {
  route: RouteSummary;
  evidence: "derived";
  distanceDeltaKm: number;
  overlapRatio: number;
}

export function findRecordedPlanMatches(
  plan: PlannedRoute,
  candidates: RouteSummary[],
): RecordedPlanMatch[] {
  const plannedDate = plan.planning.createdAt.slice(0, 10);
  const targetDistanceKm = plan.planning.intent.distanceKm;
  const distanceToleranceKm = Math.max(3, targetDistanceKm * 0.3);

  return candidates
    .flatMap((route): RecordedPlanMatch[] => {
      if (
        route.lifecycle !== "completed" ||
        route.slug === plan.planning.sourceRouteSlug ||
        route.type !== plan.planning.intent.activity ||
        route.date <= plannedDate ||
        !placesOverlap(route.region, plan.planning.intent.place) ||
        Math.abs(route.distanceKm - targetDistanceKm) > distanceToleranceKm ||
        plan.trace.length < 2 ||
        route.trace.length < 2
      ) {
        return [];
      }

      const overlapRatio = traceOverlapRatio(plan.trace, route.trace);
      if (overlapRatio < MIN_OVERLAP_RATIO) return [];

      return [{
        route,
        evidence: "derived",
        distanceDeltaKm: Math.abs(route.distanceKm - targetDistanceKm),
        overlapRatio,
      }];
    })
    .sort((left, right) =>
      right.overlapRatio - left.overlapRatio ||
      left.distanceDeltaKm - right.distanceDeltaKm ||
      right.route.date.localeCompare(left.route.date),
    );
}

function traceOverlapRatio(
  plannedTrace: PlannedRoute["trace"],
  recordedTrace: RouteSummary["trace"],
) {
  const planned = sampleTrace(plannedTrace);
  const recorded = sampleTrace(recordedTrace);
  return Math.min(
    nearbyRatio(planned, recorded),
    nearbyRatio(recorded, planned),
  );
}

function nearbyRatio(
  source: Array<{ lat: number; lng: number }>,
  comparison: Array<{ lat: number; lng: number }>,
) {
  const nearbyPoints = source.filter((point) =>
    comparison.some((candidate) => distanceKm(point, candidate) <= NEARBY_TRACE_KM),
  );
  return nearbyPoints.length / source.length;
}

function sampleTrace<T>(points: T[]) {
  if (points.length <= MAX_SAMPLE_POINTS) return points;
  return Array.from({ length: MAX_SAMPLE_POINTS }, (_, index) =>
    points[Math.round(index * (points.length - 1) / (MAX_SAMPLE_POINTS - 1))],
  );
}

function distanceKm(
  first: { lat: number; lng: number },
  second: { lat: number; lng: number },
) {
  const earthRadiusKm = 6371;
  const latitudeDelta = radians(second.lat - first.lat);
  const longitudeDelta = radians(second.lng - first.lng);
  const firstLatitude = radians(first.lat);
  const secondLatitude = radians(second.lat);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) * Math.cos(secondLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(haversine));
}

function radians(value: number) {
  return value * Math.PI / 180;
}

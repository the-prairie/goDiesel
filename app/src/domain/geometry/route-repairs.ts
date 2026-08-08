import type {
  QuestRoute,
  RouteDiscontinuityEvidence,
  RoutePoint,
} from "@/domain/route";

export interface RouteRepair extends RouteDiscontinuityEvidence {
  id: string;
  distanceM: number;
  distanceRatio: number;
  point?: Pick<RoutePoint, "lat" | "lng">;
}

export function routeRepairs(
  route: Pick<QuestRoute, "route" | "provenance">,
  totalDistanceM = route.route.at(-1)?.d ?? 0,
): RouteRepair[] {
  if (totalDistanceM <= 0) return [];

  return route.provenance.discontinuities.map((evidence, index) => {
    const distanceM = (evidence.startD + evidence.endD) / 2;
    return {
      ...evidence,
      id: `repair-${index}-${Math.round(distanceM)}`,
      distanceM,
      distanceRatio: Math.min(1, Math.max(0, distanceM / totalDistanceM)),
      point: pointAtDistance(route.route, distanceM),
    };
  });
}

export function routeRepairAriaLabel(repair: RouteRepair) {
  return `Recorded repair at ${(repair.distanceM / 1_000).toFixed(2)} km`;
}

export function routeRepairSourceLabel(repair: RouteRepair) {
  switch (repair.source) {
    case "recorded_track_segment":
      return "Recorded track segments";
    case "recorded_timestamps":
      return "Recorded timestamps";
    case "recorded_position_absence":
      return "Recorded position absence";
  }
}

export function routeRepairEvidence(repair: RouteRepair) {
  if (repair.elapsedTimeS !== undefined) {
    return `${formatDuration(repair.elapsedTimeS)} between recorded points.`;
  }
  if (repair.missingRecordCount !== undefined) {
    const records = repair.missingRecordCount === 1 ? "record" : "records";
    return `${repair.missingRecordCount} recorded position ${records} absent.`;
  }
  return "A boundary exists between recorded track segments.";
}

function pointAtDistance(points: RoutePoint[], distanceM: number) {
  if (points.length === 0) return undefined;
  if (distanceM <= points[0].d) return pickCoordinate(points[0]);

  for (let index = 1; index < points.length; index += 1) {
    const current = points[index];
    if (current.d < distanceM) continue;
    const previous = points[index - 1];
    const span = current.d - previous.d;
    const ratio = span > 0 ? (distanceM - previous.d) / span : 0;
    return {
      lat: previous.lat + (current.lat - previous.lat) * ratio,
      lng: previous.lng + (current.lng - previous.lng) * ratio,
    };
  }

  return pickCoordinate(points.at(-1)!);
}

function pickCoordinate(point: RoutePoint) {
  return { lat: point.lat, lng: point.lng };
}

function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = Math.round(totalSeconds % 60);
  return [
    hours > 0 ? `${hours} hr` : "",
    minutes > 0 ? `${minutes} min` : "",
    seconds > 0 || (hours === 0 && minutes === 0) ? `${seconds} sec` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

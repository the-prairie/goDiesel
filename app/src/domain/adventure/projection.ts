// Coordinate-to-distance projection onto one recording. Runtime-import free so
// the importer script can place prepared-pack anchors with the same rule the
// product uses to confirm them.

import type { AdventureCoordinate } from "@/domain/adventure/contract";
import type { RouteDiscontinuityEvidence, RoutePoint } from "@/domain/route";

const EARTH_RADIUS_M = 6_371_008.8;
/** At a crossing, prefer the pass near the hint, never by more than this. */
const HINT_WEIGHT_CAP_M = 25;

export function haversineM(a: AdventureCoordinate, b: AdventureCoordinate) {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLng = (b.lng - a.lng) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function insideGap(startD: number, endD: number, gaps: RouteDiscontinuityEvidence[]) {
  return gaps.some((gap) => gap.startD === gap.endD
    ? startD <= gap.startD && endD > gap.endD
    : startD < gap.endD && endD > gap.startD);
}

/**
 * The recorded distance nearest a coordinate, never inside a discontinuity.
 * `hintM` breaks ties where the recording passes the same place twice.
 */
export function projectOntoRecording(
  trace: RoutePoint[],
  gaps: RouteDiscontinuityEvidence[],
  coordinate: AdventureCoordinate,
  hintM?: number,
): { atDistanceM: number; offsetM: number } | undefined {
  const toRad = Math.PI / 180;
  const metresPerLng = EARTH_RADIUS_M * toRad * Math.cos(coordinate.lat * toRad);
  const metresPerLat = EARTH_RADIUS_M * toRad;
  const x = (point: RoutePoint) => (point.lng - coordinate.lng) * metresPerLng;
  const y = (point: RoutePoint) => (point.lat - coordinate.lat) * metresPerLat;

  let best: { atDistanceM: number; offsetM: number } | undefined;
  let bestScore = Infinity;
  const consider = (d: number, offsetM: number) => {
    const score = offsetM + (hintM === undefined ? 0 : Math.min(HINT_WEIGHT_CAP_M, Math.abs(d - hintM) / 100));
    if (score < bestScore) {
      bestScore = score;
      best = { atDistanceM: d, offsetM };
    }
  };

  if (trace.length === 1) consider(trace[0].d, Math.hypot(x(trace[0]), y(trace[0])));
  for (let index = 1; index < trace.length; index += 1) {
    const a = trace[index - 1];
    const b = trace[index];
    if (insideGap(a.d, b.d, gaps)) continue;
    const ax = x(a), ay = y(a), dx = x(b) - ax, dy = y(b) - ay;
    const length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length)) : 0;
    consider(a.d + (b.d - a.d) * t, Math.hypot(ax + dx * t, ay + dy * t));
  }
  return best;
}

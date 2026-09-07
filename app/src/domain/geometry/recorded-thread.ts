import type { RouteDiscontinuityEvidence, RoutePoint } from "@/domain/route";

/** These operations use recorded distance, never point index or map length. */
export function recordedPointAt(
  trace: RoutePoint[],
  distanceM: number,
  gaps: RouteDiscontinuityEvidence[] = [],
): RoutePoint | null {
  if (!trace.length) return null;
  let d = Math.max(trace[0].d, Math.min(trace.at(-1)!.d, Number.isFinite(distanceM) ? distanceM : 0));
  for (const gap of gaps) {
    if (d > gap.startD && d < gap.endD) {
      d = d - gap.startD < gap.endD - d ? gap.startD : gap.endD;
    }
  }
  let low = 0, high = trace.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (trace[mid].d <= d) low = mid;
    else high = mid;
  }
  const a = trace[low], b = trace[high];
  if (crossesRecordingGap(a.d, b.d, gaps)) return d - a.d < b.d - d ? a : b;
  const t = b.d > a.d ? (d - a.d) / (b.d - a.d) : 0;
  return { d, lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t, elev: a.elev + (b.elev - a.elev) * t };
}

export function crossesRecordingGap(start: number, end: number, gaps: RouteDiscontinuityEvidence[]) {
  return gaps.some((gap) => gap.startD === gap.endD
    ? start <= gap.startD && end > gap.endD
    : start < gap.endD && end > gap.startD);
}

/** A repair is an absence in the line, not a fabricated connecting segment. */
export function recordedThreadSegments(trace: RoutePoint[], gaps: RouteDiscontinuityEvidence[] = []) {
  const segments: RoutePoint[][] = [];
  let segment: RoutePoint[] = [];
  for (const point of trace) {
    const previous = segment.at(-1);
    if (previous && crossesRecordingGap(previous.d, point.d, gaps)) {
      if (segment.length > 1) segments.push(segment);
      segment = [];
    }
    segment.push(point);
  }
  if (segment.length > 1) segments.push(segment);
  return segments;
}

/** Pick the line the reader sees. Distance breaks ties at overlapping traces. */
export function nearestProjectedDistance(
  points: { x: number; y: number; d: number }[],
  x: number, y: number, heldM: number | undefined,
  gaps: RouteDiscontinuityEvidence[] = [],
) {
  let bestDistance: number | undefined;
  let bestScore = Infinity;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1], b = points[i];
    if (crossesRecordingGap(a.d, b.d, gaps)) continue;
    if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) continue;
    const dx = b.x - a.x, dy = b.y - a.y;
    const length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / length)) : 0;
    const pixelDistance = Math.hypot(x - a.x - dx * t, y - a.y - dy * t);
    const d = a.d + (b.d - a.d) * t;
    // At an overlap keep the held branch; never outweigh more than 6px of intent.
    const continuity = heldM === undefined ? 0 : Math.min(6, Math.abs(d - heldM) / 100);
    const score = pixelDistance + continuity;
    if (score < bestScore) { bestScore = score; bestDistance = d; }
  }
  return { distanceM: bestDistance, pixelDistance: bestScore };
}

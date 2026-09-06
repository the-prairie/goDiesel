import type { RoutePoint } from "@/domain/route";

/**
 * One distance-to-position-and-altitude lookup, shared by the elevation
 * readout and the map marker.
 *
 * Previously the profile reported altitude from its own 260-point simplified
 * sample while the marker interpolated the full recorded trace. Measured on
 * route 14130782031 at 50% distance the two disagreed - 279 m against 272 m.
 * The drawn profile may stay simplified, but the displayed value and the
 * geographic point must come from the same source, so both now call this.
 *
 * `progress` is a fraction of RECORDED distance, interpolated on the real `d`
 * values rather than the point index, so equal fractions mean equal distance.
 */
export interface RouteLookup {
  /** Metres along the recorded route. */
  d: number;
  /** Recorded altitude in metres. Not ascent. */
  elev: number;
  lat: number;
  lng: number;
}

export function lookupAtProgress(
  trace: RoutePoint[],
  progress: number,
): RouteLookup | null {
  if (trace.length < 2) return null;
  const total = trace[trace.length - 1].d;
  if (!Number.isFinite(total) || total <= 0) {
    const first = trace[0];
    return { d: 0, elev: first.elev, lat: first.lat, lng: first.lng };
  }

  const target = Math.min(Math.max(progress, 0), 1) * total;
  let low = 0;
  let high = trace.length - 1;
  while (low < high - 1) {
    const mid = (low + high) >> 1;
    if (trace[mid].d <= target) low = mid;
    else high = mid;
  }

  const a = trace[low];
  const b = trace[high];
  const span = b.d - a.d;
  const t = span > 0 ? (target - a.d) / span : 0;
  return {
    d: target,
    elev: a.elev + (b.elev - a.elev) * t,
    lat: a.lat + (b.lat - a.lat) * t,
    lng: a.lng + (b.lng - a.lng) * t,
  };
}

/** Total recorded distance in metres. */
export function recordedDistanceM(trace: RoutePoint[]) {
  return trace.length ? trace[trace.length - 1].d : 0;
}

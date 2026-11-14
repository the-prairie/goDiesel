// What is explored, and so drawn in colour on the sketch. For this proof it
// is her completed routes; the list takes other people's verified
// completions too, marked by who explored, so the renderer never changes.

import type { RouteSummary } from "@/domain/route";
import { isCompletedRoute } from "@/domain/route/lifecycle";

export type LngLat = [number, number];

export interface ExploredRoute {
  slug: string;
  line: LngLat[];
  /** Her own completed route, or someone else's verified completion. */
  by: "owner" | "verified";
}

export type RevealMode = "line" | "corridor" | "wash";

/** How far colour reaches from an explored route, in metres. */
export const REVEAL_RADIUS_M: Record<RevealMode, number> = { line: 0, corridor: 120, wash: 420 };

export function exploredRoutes(routes: readonly RouteSummary[], others: readonly ExploredRoute[] = []): ExploredRoute[] {
  const own = routes
    .filter((route) => isCompletedRoute(route) && route.trace.length >= 2)
    .map((route): ExploredRoute => ({ slug: route.slug, line: route.trace.map((point): LngLat => [point.lng, point.lat]), by: "owner" }));
  return [...own, ...others.filter((route) => route.line.length >= 2)];
}

const EARTH_M = 6_371_008.8;
const rad = (degrees: number) => (degrees * Math.PI) / 180;

/** Great-circle distance between two points, in metres. */
export function metresBetween(a: LngLat, b: LngLat) {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Points along a line no further apart than `spacingM`, both ends kept. */
export function samplePoints(line: readonly LngLat[], spacingM: number): LngLat[] {
  const out: LngLat[] = [line[0]];
  for (let i = 1; i < line.length; i += 1) {
    const a = line[i - 1];
    const b = line[i];
    const length = metresBetween(a, b);
    if (length === 0) continue;
    const steps = Math.ceil(length / spacingM);
    for (let k = 1; k <= steps; k += 1) {
      const t = k / steps;
      out.push(k === steps ? b : [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

/**
 * The area within `radiusM` of the routes, as a MultiPolygon of one rounded
 * strip per stretch of route, for MapLibre's `within` test. (Its `distance`
 * expression counted buildings 900 m away as within 120 m in our probe, so
 * the corridor is drawn as shapes instead.) Short stretches are merged first
 * so a long route stays a few hundred shapes.
 */
export function corridorPolygons(lines: readonly (readonly LngLat[])[], radiusM: number) {
  const coordinates: LngLat[][][] = [];
  if (radiusM <= 0) return { type: "MultiPolygon" as const, coordinates };
  const ARC = 6;
  for (const line of lines) {
    // Merge stretches shorter than the radius: the strips overlap anyway.
    const points: LngLat[] = [line[0]];
    for (const point of line.slice(1)) if (metresBetween(points[points.length - 1], point) >= radiusM * 0.4) points.push(point);
    if (points.length === 1 || points[points.length - 1] !== line[line.length - 1]) points.push(line[line.length - 1]);
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      const kx = 111_320 * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
      const ky = 110_574;
      const dx = (b[0] - a[0]) * kx;
      const dy = (b[1] - a[1]) * ky;
      const heading = Math.atan2(dy, dx);
      const ring: LngLat[] = [];
      // Round the end at b, then back round the end at a.
      for (const [centre, from] of [
        [b, heading - Math.PI / 2],
        [a, heading + Math.PI / 2],
      ] as const) {
        for (let k = 0; k <= ARC; k += 1) {
          const angle = from + (k / ARC) * Math.PI;
          ring.push([centre[0] + (Math.cos(angle) * radiusM) / kx, centre[1] + (Math.sin(angle) * radiusM) / ky]);
        }
      }
      ring.push(ring[0]);
      coordinates.push([ring]);
    }
  }
  return { type: "MultiPolygon" as const, coordinates };
}

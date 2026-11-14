// Where a moment goes when she taps a building: the footprint under her
// finger (OpenFreeMap merges a tile's buildings into a few features), and its
// sides as fronts, nearest the street first, so a placement snaps to the
// street-facing edge and "turn" steps to the others.

type LngLat = [number, number];
type Geometry = { type: "Polygon"; coordinates: LngLat[][] } | { type: "MultiPolygon"; coordinates: LngLat[][][] } | { type: string; coordinates: unknown };

function inside([x, y]: LngLat, ring: readonly LngLat[]) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** The outer ring of the footprint containing the point, or null. */
export function footprintAt(geometry: Geometry, point: LngLat): LngLat[] | null {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates as LngLat[][]] : geometry.type === "MultiPolygon" ? (geometry.coordinates as LngLat[][][]) : [];
  for (const rings of polygons) if (rings[0] && inside(point, rings[0]) && !rings.slice(1).some((hole) => inside(point, hole))) return rings[0];
  return null;
}

export interface Front {
  at: { lng: number; lat: number };
  facingDeg: number;
  frontM: number;
}

/** The footprint's sides as fronts: nearest a street first (or the longest first with none near). */
export function streetFronts(ring: readonly LngLat[], roads: readonly (readonly LngLat[])[]): Front[] {
  const points = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : [...ring];
  const lat0 = points.reduce((sum, p) => sum + p[1], 0) / points.length;
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 111_320;
  const local = ([lng, lat]: LngLat) => [lng * kx, lat * ky];
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [ax, ay] = local(points[i]);
    const [bx, by] = local(points[(i + 1) % points.length]);
    area += ax * by - bx * ay;
  }
  const segments = roads.flatMap((road) => road.slice(1).map((p, i) => [local(road[i]), local(p)]));
  const toRoad = ([px, py]: number[]) => {
    let best = Infinity;
    for (const [[ax, ay], [bx, by]] of segments) {
      const dx = bx - ax;
      const dy = by - ay;
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(ax + t * dx - px, ay + t * dy - py));
    }
    return best;
  };
  const fronts = points.flatMap((a, i) => {
    const b = points[(i + 1) % points.length];
    const [ax, ay] = local(a);
    const [bx, by] = local(b);
    const frontM = Math.hypot(bx - ax, by - ay);
    if (frontM < 3) return [];
    // Outward: to the right of a counter-clockwise ring's edge, to the left of a clockwise one's.
    const sign = area > 0 ? 1 : -1;
    const nx = ((by - ay) / frontM) * sign;
    const ny = (-(bx - ax) / frontM) * sign;
    const mid = [(ax + bx) / 2, (ay + by) / 2];
    // The street must be in front of this side, a few metres out.
    const ahead = toRoad([mid[0] + nx * 4, mid[1] + ny * 4]);
    return [{ at: { lng: (a[0] + b[0]) / 2, lat: (a[1] + b[1]) / 2 }, facingDeg: ((Math.atan2(nx, ny) * 180) / Math.PI + 360) % 360, frontM, rank: segments.length ? ahead : -frontM }];
  });
  return fronts.sort((p, q) => p.rank - q.rank).map(({ rank: _rank, ...front }) => front);
}

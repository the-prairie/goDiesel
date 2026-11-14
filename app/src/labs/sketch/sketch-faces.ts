// Which buildings are explored, and the colours they come back in. OpenFreeMap
// merges a tile's buildings into a few large features, so colouring by
// feature would colour whole districts; buildings are judged one by one here
// and drawn in colour by the edge layer (see sketch-massing). Also the roof
// triangulation the drawn buildings use.

export interface Footprint {
  rings: [number, number][][];
  height: number;
  minHeight: number;
}

const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** Indices of triangles covering a simple ring (closed or not), by ear clipping. */
export function triangulate(raw: readonly [number, number][]): number[] {
  const n = raw.length > 1 && raw[0][0] === raw[raw.length - 1][0] && raw[0][1] === raw[raw.length - 1][1] ? raw.length - 1 : raw.length;
  if (n < 3) return [];
  let signed = 0;
  for (let i = 0; i < n; i += 1) signed += cross([0, 0], raw[i], raw[(i + 1) % n]);
  const order = Array.from({ length: n }, (_, i) => i);
  if (signed < 0) order.reverse();
  const out: number[] = [];
  let guard = n * n;
  while (order.length > 3 && guard > 0) {
    guard -= 1;
    let clipped = false;
    for (let i = 0; i < order.length; i += 1) {
      const ia = order[(i - 1 + order.length) % order.length];
      const ib = order[i];
      const ic = order[(i + 1) % order.length];
      const [a, b, c] = [raw[ia], raw[ib], raw[ic]];
      if (cross(a, b, c) <= 0) continue;
      const inside = order.some((j) => j !== ia && j !== ib && j !== ic && cross(a, b, raw[j]) >= 0 && cross(b, c, raw[j]) >= 0 && cross(c, a, raw[j]) >= 0);
      if (inside) continue;
      out.push(ia, ib, ic);
      order.splice(i, 1);
      clipped = true;
      break;
    }
    // A ring too irregular to clip: fan the rest rather than lose the roof.
    if (!clipped) break;
  }
  for (let i = 1; i + 1 < order.length; i += 1) out.push(order[0], order[i], order[i + 1]);
  return out;
}

const segmentDistance2 = (px: number, py: number, s: number[]) => {
  const dx = s[2] - s[0];
  const dy = s[3] - s[1];
  const length2 = dx * dx + dy * dy;
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - s[0]) * dx + (py - s[1]) * dy) / length2));
  return (s[0] + t * dx - px) ** 2 + (s[1] + t * dy - py) ** 2;
};

/** The buildings within `radius` of the routes: full strength within half of it, half beyond. */
export function nearBuildings<T extends Footprint>(buildings: readonly T[], lines: readonly (readonly [number, number][])[], radius: number) {
  const segments: number[][] = [];
  for (const line of lines) for (let i = 1; i < line.length; i += 1) segments.push([line[i - 1][0], line[i - 1][1], line[i][0], line[i][1]]);
  const out: { building: T; strength: number }[] = [];
  if (!segments.length || radius <= 0) return out;
  const xs = segments.flatMap((s) => [s[0], s[2]]);
  const ys = segments.flatMap((s) => [s[1], s[3]]);
  const box = [Math.min(...xs) - radius, Math.min(...ys) - radius, Math.max(...xs) + radius, Math.max(...ys) + radius];
  for (const building of buildings) {
    const ring = building.rings[0];
    if (!ring.some(([x, y]) => x >= box[0] && y >= box[1] && x <= box[2] && y <= box[3])) continue;
    let best = Infinity;
    for (const [x, y] of ring) for (const s of segments) best = Math.min(best, segmentDistance2(x, y, s));
    if (best <= (radius / 2) ** 2) out.push({ building, strength: 1 });
    else if (best <= radius * radius) out.push({ building, strength: 0.5 });
  }
  return out;
}

// Trees drawn as an architect draws them: a trunk and a light round crown
// (two crossed circles, so it reads from any side). The parks and woods are
// real, from the data; where each tree stands inside them is INVENTED, on a
// jittered grid, the same every time.

type P = [number, number];

const CROWN_SIDES = 10;
/** Line segments per tree: the trunk and two crowns. */
export const TREE_SEGMENTS = 1 + CROWN_SIDES * 2;
const SPACING_M = 10;
const MAX_TREES = 1500;

function inside(x: number, y: number, rings: readonly P[][]) {
  let hit = false;
  for (const ring of rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
  return hit;
}

function unit(a: number, b: number, seed: number) {
  let h = (Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(seed, 83492791)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

/** Edges for trees inside the given polygons (each a ring list, outer first; tile units). */
export function treesIn(polygons: readonly P[][][], { metresPerUnit, seed, shrubs = false }: { metresPerUnit: number; seed: number; shrubs?: boolean }): Float32Array {
  const out: number[] = [];
  // Shrubs, in gardens and grass: low, sparser, and simpler crowns.
  const scale = shrubs ? 0.32 : 1;
  const sides = shrubs ? 6 : CROWN_SIDES;
  const limit = shrubs ? MAX_TREES / 3 : MAX_TREES;
  const step = (shrubs ? 13 : SPACING_M) / metresPerUnit;
  let count = 0;
  for (const rings of polygons) {
    const xs = rings[0].map((p) => p[0]);
    const ys = rings[0].map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    for (let gy = Math.floor(y0 / step); gy * step <= y1; gy += 1)
      for (let gx = Math.floor(x0 / step); gx * step <= x1; gx += 1) {
        if (count >= limit) return new Float32Array(out);
        const x = (gx + 0.15 + unit(gx, gy, seed) * 0.7) * step;
        const y = (gy + 0.15 + unit(gy, gx, seed + 1) * 0.7) * step;
        if (!inside(x, y, rings)) continue;
        count += 1;
        const height = (2.2 + unit(gx, gy, seed + 2) * 1.2) * scale;
        const radius = ((1.8 + unit(gx, gy, seed + 3) * 1.4) * (shrubs ? 0.5 : 1)) / metresPerUnit;
        const crown = height + radius * metresPerUnit;
        out.push(x, y, 0, x, y, height);
        for (const [ax, ay] of [
          [1, 0],
          [0, 1],
        ]) {
          for (let k = 0; k < sides; k += 1) {
            const a = (k / sides) * Math.PI * 2;
            const b = ((k + 1) / sides) * Math.PI * 2;
            out.push(x + Math.cos(a) * radius * ax, y + Math.cos(a) * radius * ay, crown + Math.sin(a) * radius * metresPerUnit, x + Math.cos(b) * radius * ax, y + Math.cos(b) * radius * ay, crown + Math.sin(b) * radius * metresPerUnit);
          }
        }
      }
  }
  return new Float32Array(out);
}

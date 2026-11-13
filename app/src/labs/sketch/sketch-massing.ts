// A building as an architect would draw it, from an open-data footprint.
//
// INVENTED DETAIL, NOT THE REAL BUILDING. OpenStreetMap gives a footprint and
// often no height, roof or facade. These rules make a plausible building of
// that kind, in that region: a height from its size and its neighbours where
// the data has none, a roof form by region and type (pitched tiled roofs on
// low Japanese houses, flat roofs behind parapets on towers), and walls
// marked with their storeys so the facade shader can draw windows, doors
// and floor lines. None of it is surveyed.
//
// Plan coordinates are tile units; heights are metres.

import { buildingEdges } from "@/labs/sketch/sketch-edges";
import { triangulate } from "@/labs/sketch/sketch-faces";

type P = [number, number];

/** Per vertex: x, y, z, u (metres along), v (metres up), shade, kind, strength, colour index. */
export const MASS_STRIDE = 9;

/** What a face is, for the facade shader. */
export const FACE = { flatRoof: 0, houseWall: 1, towerWall: 2, tiledRoof: 3, gable: 4 } as const;

export type Region = "japan" | "other";
export type Roof = "gable" | "hip" | "parapet" | "flat";

/** Above this, a height in the data is taken as real; below, it may be the default. */
const TRUSTED_M = 7.5;
const PARAPET_M = 1.0;

/** 0..1 from an integer seed, the same every time. */
function unit(seed: number, salt = 0) {
  let h = (seed ^ (salt * 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * A plausible height in metres. A real height in the data is kept; one that
 * may be the default becomes storeys by footprint size, drawn towards tall
 * neighbours. Never lower than the data, so the map's own box stays inside.
 */
export function inferHeight({ dataHeight, areaM2, neighbours, seed }: { dataHeight: number; areaM2: number; neighbours: readonly number[]; seed: number }) {
  if (dataHeight > TRUSTED_M) return dataHeight;
  const r = unit(seed);
  // Kyoto-like cities are mostly low: two storeys for a house, a few for a
  // block, more only for the largest footprints.
  const [low, high] = areaM2 <= 100 ? [6, 7.6] : areaM2 <= 200 ? [7, 9.5] : areaM2 <= 400 ? [8, 12] : areaM2 <= 1000 ? [10, 17] : [14, 24];
  let height = low + (high - low) * r;
  const tall = neighbours.filter((h) => h > TRUSTED_M);
  if (tall.length && areaM2 > 150) {
    const sorted = [...tall].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    if (median > height) height = (height + median) / 2;
  }
  return Math.max(dataHeight, Math.round(height * 10) / 10);
}

const ringArea = (ring: readonly P[]) => {
  let sum = 0;
  for (let i = 1; i < ring.length; i += 1) sum += ring[i - 1][0] * ring[i][1] - ring[i][0] * ring[i - 1][1];
  return Math.abs(sum) / 2;
};

const open = (ring: readonly P[]) => (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : [...ring]);

/** The smallest box round a footprint, its corners with the long side first. */
export function orientedBox(ring: readonly P[]) {
  const points = open(ring);
  let best: { area: number; corners: P[]; long: number; short: number } | null = null;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length === 0) continue;
    const ux = (b[0] - a[0]) / length;
    const uy = (b[1] - a[1]) / length;
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const [x, y] of points) {
      const u = x * ux + y * uy;
      const v = -x * uy + y * ux;
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (best && area >= best.area - 1e-9) continue;
    const at = (u: number, v: number): P => [u * ux - v * uy, u * uy + v * ux];
    const width = maxU - minU;
    const depth = maxV - minV;
    // Corners c0 -> c1 run along the long side.
    const corners = width >= depth ? [at(minU, minV), at(maxU, minV), at(maxU, maxV), at(minU, maxV)] : [at(minU, maxV), at(minU, minV), at(maxU, minV), at(maxU, maxV)];
    best = { area, corners, long: Math.max(width, depth), short: Math.min(width, depth) };
  }
  const area = best?.area ?? 0;
  return { corners: best?.corners ?? [], long: best?.long ?? 0, short: best?.short ?? 0, rectangularity: area > 0 ? ringArea(ring) / area : 0 };
}

/** The roof a building of this kind gets in this region. */
export function roofFor({ height, areaM2, rectangularity, aspect, region }: { height: number; areaM2: number; rectangularity: number; aspect: number; region: Region }): Roof {
  if (height > 12) return "parapet";
  if (region === "japan" && height <= 10 && rectangularity >= 0.85 && areaM2 <= 400) return aspect >= 1.4 ? "gable" : "hip";
  return "flat";
}

/** A ring pulled inwards by `by` units at every corner (mitred). */
function inset(ring: readonly P[], by: number): P[] {
  const points = open(ring);
  const sign = (() => {
    let s = 0;
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      s += a[0] * b[1] - b[0] * a[1];
    }
    return s >= 0 ? 1 : -1;
  })();
  const out = points.map((p, i) => {
    const prev = points[(i - 1 + points.length) % points.length];
    const next = points[(i + 1) % points.length];
    const n1 = normalLeft(prev, p, sign);
    const n2 = normalLeft(p, next, sign);
    const nx = n1[0] + n2[0];
    const ny = n1[1] + n2[1];
    const length = Math.hypot(nx, ny) || 1;
    const cos = Math.max(0.35, (nx * n1[0] + ny * n1[1]) / length);
    return [p[0] + (nx / length) * (by / cos), p[1] + (ny / length) * (by / cos)] as P;
  });
  return [...out, out[0]];
}

/** The unit normal pointing into the ring from the edge a-b. */
function normalLeft(a: P, b: P, sign: number): P {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy) || 1;
  return [(-dy / length) * sign, (dx / length) * sign];
}

export interface MassContext {
  metresPerUnit: number;
  region: Region;
  seed: number;
  neighbours: readonly number[];
  /** Cut by the tile's edge: keep the data's height and a flat roof, so both halves agree. */
  clipped?: boolean;
  /** Explored: how strongly (0..1) and in which of the real colours. */
  explored?: { strength: number; colour: number };
}

export function buildingMass(footprint: { rings: P[][]; height: number; minHeight: number }, ctx: MassContext) {
  const m = ctx.metresPerUnit;
  const outer = footprint.rings[0];
  const areaM2 = ringArea(outer) * m * m;
  const box = orientedBox(outer);
  const height = ctx.clipped ? footprint.height : inferHeight({ dataHeight: footprint.height, areaM2, neighbours: ctx.neighbours, seed: ctx.seed });
  const roof: Roof = ctx.clipped ? (height > 12 ? "parapet" : "flat") : roofFor({ height, areaM2, rectangularity: box.rectangularity, aspect: box.short > 0 ? box.long / box.short : 1, region: ctx.region });
  const base = footprint.minHeight;
  const eave = height;
  const wallKind = height > 10 ? FACE.towerWall : FACE.houseWall;
  const strength = ctx.explored?.strength ?? 0;
  const colour = ctx.explored?.colour ?? -1;
  const faces: number[] = [];
  const edges: number[] = [];
  const vertex = (p: P, z: number, u: number, v: number, shade: number, kind: number) => faces.push(p[0], p[1], z, u, v, shade, kind, strength, colour);
  const edge = (a: P, za: number, b: P, zb: number) => edges.push(a[0], a[1], za, b[0], b[1], zb);
  const wallShade = (a: P, b: P) => {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return 0.82 + 0.12 * Math.abs(((b[1] - a[1]) / length) * 0.6 + ((a[0] - b[0]) / length) * 0.4);
  };
  /** A wall from a to b, from z0 to z1, its u running from u0 in metres. */
  const wall = (a: P, b: P, z0: number, z1: number, kind: number) => {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) * m;
    const shade = wallShade(a, b);
    vertex(a, z0, 0, z0, shade, kind);
    vertex(b, z0, length, z0, shade, kind);
    vertex(b, z1, length, z1, shade, kind);
    vertex(a, z0, 0, z0, shade, kind);
    vertex(b, z1, length, z1, shade, kind);
    vertex(a, z1, 0, z1, shade, kind);
  };
  const flatTop = (ring: P[], z: number) => {
    for (const index of triangulate(ring)) vertex(ring[index], z, ring[index][0] * m, ring[index][1] * m, 1, FACE.flatRoof);
  };

  if (roof === "gable" || roof === "hip") {
    const [c0, c1, c2, c3] = box.corners;
    const short = box.short;
    const ridgeZ = eave + Math.min(3.5, 0.32 * short * m);
    const mid = (a: P, b: P): P => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    let r0 = mid(c0, c3);
    let r1 = mid(c1, c2);
    if (roof === "hip") {
      const dx = (r1[0] - r0[0]) / box.long;
      const dy = (r1[1] - r0[1]) / box.long;
      const pull = Math.min(short / 2, box.long / 2);
      r0 = [r0[0] + dx * pull, r0[1] + dy * pull];
      r1 = [r1[0] - dx * pull, r1[1] - dy * pull];
    }
    const sides: [P, P][] = [
      [c0, c1],
      [c1, c2],
      [c2, c3],
      [c3, c0],
    ];
    for (const [a, b] of sides) {
      wall(a, b, base, eave, wallKind);
      edge(a, base, b, base);
      edge(a, eave, b, eave);
      edge(a, base, a, eave);
    }
    // Roof slopes: u along the eave, v up the slope, in metres.
    const slope = Math.hypot((short * m) / 2, ridgeZ - eave);
    const plane = (a: P, b: P, ra: P, rb: P, shade: number) => {
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]) * m;
      const ua = 0;
      const ub = length;
      const along = (p: P) => ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (Math.hypot(b[0] - a[0], b[1] - a[1]) || 1) * m;
      vertex(a, eave, ua, 0, shade, FACE.tiledRoof);
      vertex(b, eave, ub, 0, shade, FACE.tiledRoof);
      vertex(rb, ridgeZ, along(rb), slope, shade, FACE.tiledRoof);
      vertex(a, eave, ua, 0, shade, FACE.tiledRoof);
      vertex(rb, ridgeZ, along(rb), slope, shade, FACE.tiledRoof);
      vertex(ra, ridgeZ, along(ra), slope, shade, FACE.tiledRoof);
    };
    plane(c0, c1, r0, r1, 0.93);
    plane(c2, c3, r1, r0, 0.84);
    const end = (a: P, b: P, r: P) => {
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]) * m;
      const kind = roof === "gable" ? FACE.gable : FACE.tiledRoof;
      const shade = roof === "gable" ? wallShade(a, b) : 0.88;
      vertex(a, eave, 0, roof === "gable" ? eave : 0, shade, kind);
      vertex(b, eave, length, roof === "gable" ? eave : 0, shade, kind);
      vertex(r, ridgeZ, length / 2, roof === "gable" ? ridgeZ : slope, shade, kind);
    };
    end(c1, c2, r1);
    end(c3, c0, r0);
    edge(r0, ridgeZ, r1, ridgeZ);
    edge(c0, eave, r0, ridgeZ);
    edge(c3, eave, r0, ridgeZ);
    edge(c1, eave, r1, ridgeZ);
    edge(c2, eave, r1, ridgeZ);
    return { faces: new Float32Array(faces), edges: new Float32Array(edges), roof, eave, height };
  }

  const top = roof === "parapet" ? eave + PARAPET_M : eave;
  const ring = open(outer);
  for (let i = 0; i < ring.length; i += 1) wall(ring[i], ring[(i + 1) % ring.length], base, top, wallKind);
  for (const hole of footprint.rings.slice(1)) {
    const inner = open(hole);
    for (let i = 0; i < inner.length; i += 1) wall(inner[i], inner[(i + 1) % inner.length], base, top, wallKind);
  }
  const walls = buildingEdges(footprint.rings, top, base);
  for (const value of walls) edges.push(value);
  if (roof === "parapet") {
    // The roof sits a parapet's height below the top; the parapet's inner face rises to it.
    const lip = inset(outer, 0.4 / m);
    flatTop(lip, eave);
    const lipRing = open(lip);
    for (let i = 0; i < lipRing.length; i += 1) {
      const a = lipRing[i];
      const b = lipRing[(i + 1) % lipRing.length];
      wall(b, a, eave, top, FACE.flatRoof);
      edge(a, top, b, top);
      edge(a, eave, b, eave);
    }
    // The top of the parapet, between its outer and inner lines.
    const outerOpen = open(outer);
    for (let i = 0; i < outerOpen.length; i += 1) {
      const a = outerOpen[i];
      const b = outerOpen[(i + 1) % outerOpen.length];
      const ia = lipRing[i];
      const ib = lipRing[(i + 1) % lipRing.length];
      vertex(a, top, 0, 0, 1, FACE.flatRoof);
      vertex(b, top, 0, 0, 1, FACE.flatRoof);
      vertex(ib, top, 0, 0, 1, FACE.flatRoof);
      vertex(a, top, 0, 0, 1, FACE.flatRoof);
      vertex(ib, top, 0, 0, 1, FACE.flatRoof);
      vertex(ia, top, 0, 0, 1, FACE.flatRoof);
    }
  } else flatTop(outer, top);
  return { faces: new Float32Array(faces), edges: new Float32Array(edges), roof, eave, height };
}

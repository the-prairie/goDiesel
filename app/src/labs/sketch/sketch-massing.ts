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
import { buildingForm, type Form, type Landmark } from "@/labs/sketch/sketch-form";
import type { RegionId } from "@/labs/sketch/sketch-region";

type P = [number, number];

/** Per vertex: x, y, z, u (metres along), v (metres up), shade, kind, strength, colour index. */
export const MASS_STRIDE = 9;

/** What a face is, for the facade shader. */
export const FACE = {
  flatRoof: 0,
  houseWall: 1,
  towerWall: 2,
  tiledRoof: 3,
  gable: 4,
  /** A mansion block's long face: a balcony band each storey. */
  balcony: 5,
  /** An end or party wall: storey lines only. */
  blank: 6,
  /** A curtain wall: mullions and spandrels. */
  glass: 7,
  shed: 8,
  /** A school or hospital: ribbon windows. */
  ribbon: 9,
  retail: 10,
  temple: 11,
  shrine: 12,
  church: 13,
  sheetRoof: 14,
} as const;

export type Region = RegionId;
export type Roof = "gable" | "hip" | "irimoya" | "steep" | "parapet" | "flat" | "sheet";

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

/** Each region's houses: how steep, how deep the eaves, and which roof for a long or a squarish plan. */
const REGION_ROOF: Record<RegionId, { pitch: number; eaveM: number; long: Roof; square: Roof }> = {
  japan: { pitch: 0.32, eaveM: 0.7, long: "gable", square: "hip" },
  mediterranean: { pitch: 0.2, eaveM: 0.3, long: "hip", square: "hip" },
  aegean: { pitch: 0, eaveM: 0, long: "flat", square: "flat" },
  "northern-europe": { pitch: 0.55, eaveM: 0.25, long: "gable", square: "gable" },
  "north-america": { pitch: 0.38, eaveM: 0.4, long: "gable", square: "hip" },
  tropical: { pitch: 0.5, eaveM: 1, long: "hip", square: "hip" },
  other: { pitch: 0.3, eaveM: 0.35, long: "gable", square: "hip" },
};

export const regionRoof = (region: RegionId) => REGION_ROOF[region];

/** The roof a building of this form gets in this region; landmarks have their own. */
export function roofFor({ form, rectangularity, aspect, region, landmark, height }: { form: Form; areaM2: number; rectangularity: number; aspect: number; region: RegionId; landmark?: Landmark; height?: number }): Roof {
  if (landmark === "temple") return "irimoya";
  if (landmark === "shrine") return "gable";
  if (landmark === "church") return "steep";
  if (form === "shed") return "sheet";
  if (form === "house") return aspect >= 1.4 ? REGION_ROOF[region].long : REGION_ROOF[region].square;
  // Italian and Spanish blocks: a low hipped roof of tiles, not a flat top.
  if (form === "block" && region === "mediterranean" && rectangularity >= 0.8 && (height ?? Infinity) <= 20) return "hip";
  return (height ?? Infinity) > 12 ? "parapet" : "flat";
}

/** How each pitched roof is drawn: pitch, eaves, how far its hips pull the ridge in (of the short side), and a cap on its rise. */
const PITCHED: Partial<Record<Roof, { pitch?: number; eaveM?: number; pull: number; maxRise: number }>> = {
  gable: { pull: 0, maxRise: 5 },
  hip: { pull: 0.5, maxRise: 5 },
  irimoya: { pitch: 0.45, eaveM: 1.6, pull: 0.3, maxRise: 10 },
  steep: { pitch: 0.75, eaveM: 0.3, pull: 0, maxRise: 12 },
};

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
  region: RegionId;
  seed: number;
  neighbours: readonly number[];
  /** Cut by the tile's edge: keep the data's height and a flat roof, so both halves agree. */
  clipped?: boolean;
  /** Explored: how strongly (0..1) and in which of the region's colours. */
  explored?: { strength: number; colour: number };
  /** The land use class the footprint stands in, if any. */
  landuse?: string;
  /** A place of worship inside the footprint. */
  landmark?: Landmark;
}

const ROOFTOP_M = 2.6;

export function buildingMass(footprint: { rings: P[][]; height: number; minHeight: number }, ctx: MassContext) {
  const m = ctx.metresPerUnit;
  const outer = footprint.rings[0];
  const areaM2 = ringArea(outer) * m * m;
  const box = orientedBox(outer);
  const aspect = box.short > 0 ? box.long / box.short : 1;
  const inferred = ctx.clipped ? footprint.height : inferHeight({ dataHeight: footprint.height, areaM2, neighbours: ctx.neighbours, seed: ctx.seed });
  const form = buildingForm({ areaM2, height: inferred, rectangularity: ctx.clipped ? 0 : box.rectangularity, region: ctx.region, landuse: ctx.landuse });
  // A landmark needs a plan its roof can stand on; otherwise it is drawn as its form.
  const landmark = !ctx.clipped && box.rectangularity >= 0.7 ? ctx.landmark : undefined;
  const roof: Roof = ctx.clipped ? (form === "shed" ? "sheet" : inferred > 12 ? "parapet" : "flat") : roofFor({ form, areaM2, rectangularity: footprint.rings.length > 1 ? 0 : box.rectangularity, aspect, region: ctx.region, landmark, height: inferred });
  // Temples and shrines stand low under their roofs.
  const height = landmark === "temple" || landmark === "shrine" ? Math.min(inferred, landmark === "temple" ? 5.5 : 4) : inferred;
  const base = footprint.minHeight;
  const eave = height;
  const strength = ctx.explored?.strength ?? 0;
  const colour = ctx.explored?.colour ?? -1;
  const faces: number[] = [];
  const edges: number[] = [];
  const vertex = (p: P, z: number, u: number, v: number, shade: number, kind: number) => faces.push(p[0], p[1], z, u, v, shade, kind, strength, colour);
  const edge = (a: P, za: number, b: P, zb: number) => edges.push(a[0], a[1], za, b[0], b[1], zb);
  const unitOf = (a: P, b: P): P => {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
  };
  const axis = box.corners.length === 4 ? unitOf(box.corners[0], box.corners[1]) : ([1, 0] as P);
  /** The face a wall from a to b gets, by the building's form and which way it faces. */
  const wallKind = (a: P, b: P) => {
    if (landmark) return FACE[landmark];
    if (form === "house") return FACE.houseWall;
    if (form === "shed" || form === "retail") return FACE[form];
    if (form === "institution") return FACE.ribbon;
    if (form === "mansion") {
      const d = unitOf(a, b);
      return Math.abs(d[0] * axis[0] + d[1] * axis[1]) > 0.8 ? FACE.balcony : FACE.blank;
    }
    if (form === "tower" && !["japan", "mediterranean", "aegean", "tropical"].includes(ctx.region)) return FACE.glass;
    return FACE.towerWall;
  };
  const wallShade = (a: P, b: P) => {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return 0.82 + 0.12 * Math.abs(((b[1] - a[1]) / length) * 0.6 + ((a[0] - b[0]) / length) * 0.4);
  };
  /** A wall from a to b, from z0 to z1, its u running in metres along it. */
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
  const flatTop = (ring: P[], z: number, kind: number = FACE.flatRoof) => {
    for (const index of triangulate(ring)) vertex(ring[index], z, ring[index][0] * m, ring[index][1] * m, 1, kind);
  };
  /** A box on the roof (plant room, water tank): ten triangles. */
  const rooftop = (z: number) => {
    const [c0, c1, , c3] = box.corners;
    const u = unitOf(c0, c1);
    const v = unitOf(c0, c3);
    const centre: P = box.corners.reduce((sum, p) => [sum[0] + p[0] / 4, sum[1] + p[1] / 4], [0, 0] as P);
    const hl = Math.min(8, 0.3 * box.long * m) / m / 2;
    const hw = Math.min(6, 0.3 * box.short * m) / m / 2;
    const at = (su: number, sv: number): P => [centre[0] + u[0] * hl * su + v[0] * hw * sv, centre[1] + u[1] * hl * su + v[1] * hw * sv];
    const ring = [at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)];
    const top = z + ROOFTOP_M;
    for (let i = 0; i < 4; i += 1) {
      const a = ring[i];
      const b = ring[(i + 1) % 4];
      wall(a, b, z, top, FACE.blank);
      edge(a, z, a, top);
      edge(a, top, b, top);
    }
    flatTop([...ring, ring[0]], top);
  };

  const pitched = PITCHED[roof];
  if (pitched && box.corners.length === 4) {
    const [c0, c1, c2, c3] = box.corners;
    const style = REGION_ROOF[ctx.region];
    const short = box.short;
    const rise = Math.min(pitched.maxRise, (pitched.pitch ?? style.pitch) * short * m);
    const over = (pitched.eaveM ?? (roof === "gable" && landmark === "shrine" ? 1 : style.eaveM)) / m;
    const ridgeZ = eave + rise;
    const lipZ = eave - Math.min(0.4, over * m * 0.35);
    const u = unitOf(c0, c1);
    const v = unitOf(c0, c3);
    const out = (p: P, su: number, sv: number): P => [p[0] + (u[0] * su + v[0] * sv) * over, p[1] + (u[1] * su + v[1] * sv) * over];
    const e0 = out(c0, -1, -1);
    const e1 = out(c1, 1, -1);
    const e2 = out(c2, 1, 1);
    const e3 = out(c3, -1, 1);
    const mid = (a: P, b: P): P => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    // The ridge: over the gables' verges for a gable, pulled in for hips.
    const pull = pitched.pull ? Math.min(short * pitched.pull, box.long / 2) : -over;
    const r0: P = [mid(c0, c3)[0] + u[0] * pull, mid(c0, c3)[1] + u[1] * pull];
    const r1: P = [mid(c1, c2)[0] - u[0] * pull, mid(c1, c2)[1] - u[1] * pull];
    for (const [a, b] of [[c0, c1], [c1, c2], [c2, c3], [c3, c0]] as [P, P][]) {
      wall(a, b, base, eave, wallKind(a, b));
      edge(a, base, b, base);
      edge(a, base, a, eave);
    }
    // Roof planes from the lip of the eaves up to the ridge; seen from below, the shader shades them as soffits.
    const slope = Math.hypot((short * m) / 2 + over * m, rise);
    const along = (a: P, b: P, p: P) => (((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (Math.hypot(b[0] - a[0], b[1] - a[1]) || 1)) * m;
    const plane = (a: P, b: P, ra: P, rb: P, shade: number) => {
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]) * m;
      vertex(a, lipZ, 0, 0, shade, FACE.tiledRoof);
      vertex(b, lipZ, length, 0, shade, FACE.tiledRoof);
      vertex(rb, ridgeZ, along(a, b, rb), slope, shade, FACE.tiledRoof);
      vertex(a, lipZ, 0, 0, shade, FACE.tiledRoof);
      vertex(rb, ridgeZ, along(a, b, rb), slope, shade, FACE.tiledRoof);
      vertex(ra, ridgeZ, along(a, b, ra), slope, shade, FACE.tiledRoof);
    };
    plane(e0, e1, r0, r1, 0.93);
    plane(e2, e3, r1, r0, 0.84);
    const gableEnd = (a: P, b: P) => {
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]) * m;
      const shade = wallShade(a, b);
      vertex(a, eave, 0, eave, shade, FACE.gable);
      vertex(b, eave, length, eave, shade, FACE.gable);
      vertex(mid(a, b), ridgeZ, length / 2, ridgeZ, shade, FACE.gable);
    };
    if (pitched.pull === 0) {
      gableEnd(c1, c2);
      gableEnd(c3, c0);
    } else {
      const hipEnd = (a: P, b: P, r: P) => {
        vertex(a, lipZ, 0, 0, 0.88, FACE.tiledRoof);
        vertex(b, lipZ, Math.hypot(b[0] - a[0], b[1] - a[1]) * m, 0, 0.88, FACE.tiledRoof);
        vertex(r, ridgeZ, (Math.hypot(b[0] - a[0], b[1] - a[1]) * m) / 2, slope, 0.88, FACE.tiledRoof);
      };
      hipEnd(e1, e2, r1);
      hipEnd(e3, e0, r0);
      if (roof === "irimoya") {
        // The irimoya's small gable, upright under each end of the ridge.
        for (const [r, a, b] of [[r1, e1, e2], [r0, e3, e0]] as [P, P, P][]) {
          const t = 0.45;
          const pa: P = [r[0] + (a[0] - r[0]) * t, r[1] + (a[1] - r[1]) * t];
          const pb: P = [r[0] + (b[0] - r[0]) * t, r[1] + (b[1] - r[1]) * t];
          const z = ridgeZ - (ridgeZ - lipZ) * t;
          vertex(pa, z, 0, z, 0.9, FACE.gable);
          vertex(pb, z, 1, z, 0.9, FACE.gable);
          vertex(r, ridgeZ, 0.5, ridgeZ, 0.9, FACE.gable);
          edge(pa, z, pb, z);
        }
      }
    }
    edge(e0, lipZ, e1, lipZ);
    edge(e1, lipZ, e2, lipZ);
    edge(e2, lipZ, e3, lipZ);
    edge(e3, lipZ, e0, lipZ);
    edge(r0, ridgeZ, r1, ridgeZ);
    edge(e0, lipZ, r0, ridgeZ);
    edge(e3, lipZ, r0, ridgeZ);
    edge(e1, lipZ, r1, ridgeZ);
    edge(e2, lipZ, r1, ridgeZ);
    if (landmark === "church") {
      // A square tower at one end, rising above the ridge, under a spire.
      const side = Math.min(short * 0.6, 8 / m);
      const half = side / 2;
      const end = mid(c0, c3);
      const centre: P = [end[0] + u[0] * half, end[1] + u[1] * half];
      const at = (su: number, sv: number): P => [centre[0] + u[0] * half * su + v[0] * half * sv, centre[1] + u[1] * half * su + v[1] * half * sv];
      const ring = [at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)];
      const top = ridgeZ + Math.max(8, 0.3 * box.long * m);
      const spire = top + side * m * 0.9;
      for (let i = 0; i < 4; i += 1) {
        const a = ring[i];
        const b = ring[(i + 1) % 4];
        wall(a, b, base, top, FACE.church);
        edge(a, base, a, top);
        edge(a, top, b, top);
        vertex(a, top, 0, 0, 0.9, FACE.tiledRoof);
        vertex(b, top, 1, 0, 0.9, FACE.tiledRoof);
        vertex(centre, spire, 0.5, 1, 0.9, FACE.tiledRoof);
        edge(a, top, centre, spire);
      }
    }
    return { faces: new Float32Array(faces), edges: new Float32Array(edges), roof, eave, height, form };
  }

  const top = roof === "parapet" ? eave + PARAPET_M : eave;
  const ring = open(outer);
  for (let i = 0; i < ring.length; i += 1) wall(ring[i], ring[(i + 1) % ring.length], base, top, wallKind(ring[i], ring[(i + 1) % ring.length]));
  for (const hole of footprint.rings.slice(1)) {
    const inner = open(hole);
    for (let i = 0; i < inner.length; i += 1) wall(inner[i], inner[(i + 1) % inner.length], base, top, form === "mansion" ? FACE.balcony : wallKind(inner[i], inner[(i + 1) % inner.length]));
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
    if (!ctx.clipped && box.corners.length === 4 && areaM2 >= 300 && (form === "mansion" || form === "tower" || form === "institution" || (form === "block" && areaM2 >= 600))) rooftop(eave);
  } else flatTop(outer, top, roof === "sheet" ? FACE.sheetRoof : FACE.flatRoof);
  return { faces: new Float32Array(faces), edges: new Float32Array(edges), roof, eave, height, form };
}

/**
 * Bytes per vertex once packed for the GPU: position as three floats, the
 * facade coordinates as two half floats, then shade, kind, strength and
 * colour as one byte each (colour 255 for none). A dense city tile's
 * buildings run to hundreds of thousands of triangles; this keeps them to
 * well under half the size of plain floats.
 */
export const PACKED_BYTES = 20;

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

/** A number as an IEEE half float, rounded. */
export function floatToHalf(value: number) {
  f32[0] = value;
  const x = u32[0];
  const sign = (x >>> 16) & 0x8000;
  const exponent = ((x >>> 23) & 0xff) - 127 + 15;
  let mantissa = x & 0x7fffff;
  if (exponent <= 0) return sign;
  if (exponent >= 31) return sign | 0x7c00;
  mantissa += 0x1000;
  if (mantissa & 0x800000) return sign | ((exponent + 1) << 10);
  return sign | (exponent << 10) | (mantissa >>> 13);
}

export function halfToFloat(half: number) {
  const sign = half & 0x8000 ? -1 : 1;
  const exponent = (half >>> 10) & 0x1f;
  const mantissa = half & 0x3ff;
  if (exponent === 0) return sign * 2 ** -14 * (mantissa / 1024);
  if (exponent === 31) return mantissa ? NaN : sign * Infinity;
  return sign * 2 ** (exponent - 15) * (1 + mantissa / 1024);
}

export function packFaces(faces: Float32Array): ArrayBuffer {
  const vertices = faces.length / MASS_STRIDE;
  const buffer = new ArrayBuffer(vertices * PACKED_BYTES);
  const view = new DataView(buffer);
  for (let v = 0; v < vertices; v += 1) {
    const o = v * PACKED_BYTES;
    const f = v * MASS_STRIDE;
    view.setFloat32(o, faces[f], true);
    view.setFloat32(o + 4, faces[f + 1], true);
    view.setFloat32(o + 8, faces[f + 2], true);
    view.setUint16(o + 12, floatToHalf(faces[f + 3]), true);
    view.setUint16(o + 14, floatToHalf(faces[f + 4]), true);
    view.setUint8(o + 16, Math.round(Math.min(1, Math.max(0, faces[f + 5])) * 255));
    view.setUint8(o + 17, faces[f + 6]);
    view.setUint8(o + 18, Math.round(Math.min(1, Math.max(0, faces[f + 7])) * 255));
    view.setUint8(o + 19, faces[f + 8] < 0 ? 255 : faces[f + 8]);
  }
  return buffer;
}

// A town, generated from one of her places: where the ground, the paths,
// the water, the houses, the trees and a signpost for each of her routes
// go. Pure and deterministic: the same place always grows the same town,
// and the result is plain data the renderer paints. One world unit is
// sixteen texels of the town's pixel art.
//
// The layout template is the approved Kyoto diorama: a loop road with
// houses inside and behind it, a pond and a garden, and a front edge where
// the signposts stand, with water or open ground beyond it.

import { hash } from "@/labs/overland/engine/noise";
import type { Biome } from "@/labs/overland/model/place-biomes";
import {
  BIOME_KITS,
  HOUSE_SPECS,
  SNOW_GROUND,
  cityHouses,
  type Backdrop,
  type BedKind,
  type CornerProp,
  type FieldKind,
  type Filler,
  type GroundPalette,
  type HouseKind,
  type Season,
  type TreeSpecies,
} from "@/labs/overland/model/town-kits";

export type { Season, TreeSpecies, HouseKind } from "@/labs/overland/model/town-kits";

export interface TownRoute {
  slug: string;
  /** The route's number, as the app numbers routes. */
  number: number;
  /** Her title, exactly as she wrote it. */
  title: string;
  km: number;
  date: string;
  kind: "run" | "ride";
  /** The compass bearing the route leaves its start on, in degrees. */
  startBearingDeg: number;
}

/** Where a resident likes to stand. Another artist draws the residents. */
export const RESIDENT_SPOTS = ["plaza", "pond", "signposts", "porch", "path", "water", "edge"] as const;
export type ResidentSpot = (typeof RESIDENT_SPOTS)[number];

export interface TownResident {
  id: string;
  nickname: string;
  spot: ResidentSpot;
}

export interface TownInput {
  place: string;
  lat: number;
  lng: number;
  biome: Biome;
  coastal: boolean;
  routes: readonly TownRoute[];
  residents?: readonly TownResident[];
}

export interface Segment {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  /** Half the path's width. */
  hw: number;
}

export interface Rect {
  x: number;
  z: number;
  /** Full width along x and depth along z. */
  w: number;
  d: number;
}

export interface House {
  id: string;
  kind: HouseKind;
  x: number;
  z: number;
  /** World units. */
  width: number;
  depth: number;
  /** Texels, for the painters. */
  wp: number;
  dp: number;
  hp: number;
  /** A per-house nudge to colours, from 0 to 1. */
  tone: number;
}

export interface Tree {
  x: number;
  z: number;
  species: TreeSpecies;
  scale: number;
  /** Placed by hand in the template, rather than filling the forest. */
  feature: boolean;
  /** 0 is drawn first and dropped last; a lower quality keeps the lowest ranks. */
  rank: number;
}

export interface Block {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  tone: number;
}

export type Prop =
  | { kind: "fence"; x1: number; z1: number; x2: number; z2: number }
  | { kind: "bed"; bed: BedKind; x: number; z: number; w: number; d: number }
  | { kind: "shrub"; x: number; z: number; s: number }
  | { kind: "bench"; x: number; z: number }
  | { kind: "pole"; x: number; z: number }
  | { kind: "corner"; corner: CornerProp; x: number; z: number };

export type Water =
  | { kind: "canal"; z0: number; z1: number; bridgeX: number }
  | { kind: "creek"; z0: number; z1: number; bridgeX: number }
  | { kind: "shore"; sand: number; z0: number; jettyX: number }
  | { kind: "none" };

export interface Signpost {
  slug: string;
  number: number;
  /** The number on the board, zero-padded to three digits. */
  label: string;
  title: string;
  km: number;
  date: string;
  kind: "run" | "ride";
  x: number;
  z: number;
  /** The way the board's arrow points: -1 west, 1 east. */
  side: -1 | 1;
  /** Which post the board hangs on, and how high: 0 is the top board. */
  post: number;
  tier: number;
  bearingDeg: number;
}

export interface ResidentPlacement extends TownResident {
  x: number;
  z: number;
}

export interface TownPlan {
  place: string;
  seed: number;
  biome: Biome;
  season: Season;
  snow: boolean;
  canopy: TreeSpecies;
  filler: Filler;
  field: FieldKind;
  backdrop: Backdrop;
  ground: GroundPalette;
  shrub: [string, string, string, string];
  water: Water;
  pond: Rect | null;
  loop: { x0: number; x1: number; z0: number; z1: number; r: number; hw: number };
  paths: Segment[];
  /** The town proper; the forest, fields or blocks lie outside it. */
  bounds: { x0: number; x1: number; z0: number; z1: number };
  houses: House[];
  trees: Tree[];
  blocks: Block[];
  props: Prop[];
  signposts: Signpost[];
  /** Where the runner starts, on the loop. */
  spawn: { x: number; z: number };
  /** The loop the runner jogs, as points. */
  runnerLoop: Array<[number, number]>;
  timeOfDay: "morning" | "golden" | "dusk";
  residents: ResidentPlacement[];
}

// ---------------------------------------------------------------- noise

function h2(i: number, j: number, s: number) {
  let n = (Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263) + Math.imul((s | 0) + 1, 1442695041)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  n ^= n >>> 16;
  return (n >>> 0) / 4294967296;
}

/** Smooth value noise in 0..1, the prototype's. */
export function valueNoise(x: number, y: number, s: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = h2(xi, yi, s);
  const b = h2(xi + 1, yi, s);
  const c = h2(xi, yi + 1, s);
  const d = h2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export { h2 as cellHash };

const round = (value: number) => Math.round(value * 1000) / 1000;

// ---------------------------------------------------------------- season

/** The season of her time in a place: the middle of her dates, by hemisphere. */
export function townSeason(dates: readonly string[], lat: number): Season {
  if (Math.abs(lat) < 23.5) return "tropical";
  const sorted = [...dates].sort();
  const middle = sorted[Math.floor(sorted.length / 2)] ?? "2025-06-01";
  let month = Number(middle.slice(5, 7)) - 1;
  if (lat < 0) month = (month + 6) % 12;
  if (month === 11 || month <= 1) return "winter";
  if (month <= 4) return "spring";
  if (month <= 7) return "summer";
  return "autumn";
}

// ---------------------------------------------------------------- template

const LOOP = { x0: -5, x1: 5, z0: -4.5, z1: 3.5, r: 1.2, hw: 0.7 };
const FRONT_Z = 9.3;
const MAIN_X = 1.55;
const SIGN_Z = 8.45;
const CANAL = { z0: 10.2, z1: 12.4 };
const CREEK = { z0: 10.5, z1: 11.7 };
const SHORE = { sand: 9.95, z0: 11.5 };
const POND: Rect = { x: -3.1, z: 6.4, w: 4.8, d: 2.6 };

interface Lot {
  id: string;
  x: number;
  z: number;
  maxW: number;
  maxD: number;
}

const LOTS: Lot[] = [
  { id: "A", x: -2.2, z: -1.3, maxW: 72, maxD: 50 },
  { id: "B", x: 2.55, z: -1.5, maxW: 54, maxD: 56 },
  { id: "K", x: -3.2, z: -7.0, maxW: 56, maxD: 44 },
  { id: "C", x: 2.6, z: -7.2, maxW: 60, maxD: 46 },
  { id: "L", x: -7.7, z: 1.9, maxW: 52, maxD: 46 },
  { id: "R", x: 7.7, z: 1.7, maxW: 52, maxD: 46 },
];

/** The prototype's hand-placed trees: position, which accent, and size. */
const FEATURE_TREES: Array<[number, number, number, number]> = [
  [-6.5, 4.9, 0, 0.72], [-6.4, -2.6, 1, 0.62], [6.5, 4.6, 0, 0.74], [6.4, -3.3, 1, 0.64], [-6.2, 5.7, 0, 0.83],
  [-0.3, 7.1, 1, 0.68], [-6.4, 7.6, 2, 0.58], [4.6, 6.6, 0, 0.79], [6.6, 7.3, 2, 0.72], [0, -7.6, 2, 0.97],
  [5.6, -7.6, 0, 0.72], [-6.3, -6.8, 1, 0.72], [4.0, 1.55, 0, 0.5], [-0.2, -3.4, 1, 0.45],
  [-5.2, 13.9, 0, 0.79], [3.7, 14.5, 1, 0.76], [9.2, 13.9, 2, 0.86], [-11.2, 13.6, 1, 0.72], [12.4, 14.8, 0, 0.79],
  [-1.4, 14.9, 2, 0.65], [7, 15.2, 0, 0.65], [-8.4, 15.3, 0, 0.61],
];

const SHRUBS: Array<[number, number]> = [[0.25, 0.75], [1.15, 0.7], [1.75, 0.7], [4.0, 0.6], [-5.0, -5.6], [-1.4, -5.65], [0.9, -5.75], [5.1, -5.75], [-5.9, 4.2], [-0.9, 4.2]];

function segmentDistance(x: number, z: number, s: Segment) {
  const dx = s.x2 - s.x1;
  const dz = s.z2 - s.z1;
  const length = dx * dx + dz * dz;
  let t = length ? ((x - s.x1) * dx + (z - s.z1) * dz) / length : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const px = s.x1 + dx * t - x;
  const pz = s.z1 + dz * t - z;
  return Math.sqrt(px * px + pz * pz) - s.hw;
}

/** Signed distance to the nearest path's edge: negative on a path. */
export function pathDistance(plan: Pick<TownPlan, "paths">, x: number, z: number) {
  let best = 1e9;
  for (const segment of plan.paths) best = Math.min(best, segmentDistance(x, z, segment));
  return best;
}

function buildPaths(water: Water["kind"]): Segment[] {
  const { x0, x1, z0, z1, hw } = LOOP;
  const seg = (a: number, b: number, c: number, d: number, w: number): Segment => ({ x1: a, z1: b, x2: c, z2: d, hw: w });
  const paths = [
    seg(x0, z0, x1, z0, hw),
    seg(x1, z0, x1, z1, hw),
    seg(x1, z1, x0, z1, hw),
    seg(x0, z1, x0, z0, hw),
    seg(x0, -0.35, -34, -0.35, 0.62),
    seg(x1, -1.25, 34, -1.25, 0.62),
    seg(-34, FRONT_Z, 34, FRONT_Z, 0.52),
    seg(-0.85, 0.3, -0.85, z1, 0.42),
    seg(3.35, 0.2, 3.35, z1, 0.42),
    seg(-3.2, -5.6, -3.2, z0, 0.4),
    seg(2.6, -5.8, 2.6, z0, 0.42),
  ];
  if (water === "canal" || water === "creek") {
    const far = water === "canal" ? CANAL.z1 : CREEK.z1;
    paths.push(seg(MAIN_X, z1, MAIN_X, water === "canal" ? CANAL.z0 : CREEK.z0, 0.62), seg(MAIN_X, far, MAIN_X, 34, 0.62));
  } else if (water === "shore") {
    paths.push(seg(MAIN_X, z1, MAIN_X, FRONT_Z, 0.62));
  } else {
    paths.push(seg(MAIN_X, z1, MAIN_X, 34, 0.62));
  }
  return paths;
}

function runnerLoop(): Array<[number, number]> {
  const { x0, x1, z0, z1, r } = LOOP;
  const points: Array<[number, number]> = [];
  const arc = (cx: number, cz: number, a0: number) => {
    for (let i = 0; i <= 6; i += 1) {
      const a = a0 + (i / 6) * (Math.PI / 2);
      points.push([round(cx + Math.cos(a) * r), round(cz + Math.sin(a) * r)]);
    }
  };
  arc(x0 + r, z1 - r, Math.PI / 2);
  arc(x0 + r, z0 + r, Math.PI);
  arc(x1 - r, z0 + r, -Math.PI / 2);
  arc(x1 - r, z1 - r, 0);
  points.push(points[0]);
  return points;
}

function pointAlong(points: Array<[number, number]>, fraction: number) {
  const lengths = [0];
  for (let i = 1; i < points.length; i += 1) {
    lengths.push(lengths[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  }
  const target = lengths[lengths.length - 1] * fraction;
  let i = 1;
  while (i < lengths.length - 1 && lengths[i] < target) i += 1;
  const f = (target - lengths[i - 1]) / (lengths[i] - lengths[i - 1] || 1);
  return { x: round(points[i - 1][0] + (points[i][0] - points[i - 1][0]) * f), z: round(points[i - 1][1] + (points[i][1] - points[i - 1][1]) * f) };
}

// ---------------------------------------------------------------- the generator

function houseCount(routes: number) {
  if (routes <= 1) return 3;
  if (routes <= 3) return 4;
  if (routes <= 5) return 5;
  return 6;
}

function buildHouses(kinds: HouseKind[], count: number, seed: number): House[] {
  const offset = seed % kinds.length;
  const order = kinds.map((_, index) => kinds[(index + offset) % kinds.length]);
  const houses: House[] = [];
  let unused = [...order];
  for (const lot of LOTS.slice(0, count)) {
    // Every kind once before any twice; the first in turn that fits the
    // lot, or else the first, made to fit.
    if (unused.length === 0) unused = [...order];
    const fits = unused.find((kind) => HOUSE_SPECS[kind].width <= lot.maxW && HOUSE_SPECS[kind].depth <= lot.maxD);
    const kind = fits ?? unused[0];
    unused = unused.filter((candidate) => candidate !== kind);
    const spec = HOUSE_SPECS[kind];
    const wp = Math.min(spec.width, lot.maxW);
    const dp = Math.min(spec.depth, lot.maxD);
    houses.push({
      id: lot.id,
      kind,
      x: lot.x,
      z: lot.z,
      width: wp / 16,
      depth: dp / 16,
      wp,
      dp,
      hp: spec.height,
      tone: round(h2(seed % 9973, lot.id.charCodeAt(0), 41)),
    });
  }
  return houses;
}

function inHouses(houses: readonly House[], x: number, z: number, pad: number) {
  return houses.some((house) => Math.abs(x - house.x) < house.width / 2 + pad && Math.abs(z - house.z) < house.depth / 2 + pad);
}

const POST_SLOTS: Record<number, number[]> = {
  1: [],
  2: [-1.15, 4.25],
  3: [-3.55, -1.15, 4.25],
  4: [-3.55, -1.15, 4.25, 6.4],
};

function buildSignposts(routes: readonly TownRoute[]): Signpost[] {
  if (routes.length === 0) return [];
  const east = (route: TownRoute) => Math.sin((route.startBearingDeg * Math.PI) / 180);
  const sorted = [...routes].sort((a, b) => east(a) - east(b) || a.number - b.number);
  const posts = Math.min(4, sorted.length);
  const slots = posts === 1 ? [east(sorted[0]) < 0 ? -1.15 : 4.25] : POST_SLOTS[posts];
  const perPost = Math.ceil(sorted.length / posts);
  const extra = sorted.length % posts;
  const signs: Signpost[] = [];
  let index = 0;
  for (let post = 0; post < posts; post += 1) {
    // Spread the boards as evenly as the posts allow.
    const take = extra === 0 ? perPost : post < extra ? perPost : perPost - 1;
    for (let tier = 0; tier < take && index < sorted.length; tier += 1, index += 1) {
      const route = sorted[index];
      const x = slots[post];
      signs.push({
        slug: route.slug,
        number: route.number,
        label: String(route.number).padStart(3, "0"),
        title: route.title,
        km: route.km,
        date: route.date,
        kind: route.kind,
        x,
        z: SIGN_Z,
        side: x < MAIN_X ? -1 : 1,
        post,
        tier,
        bearingDeg: route.startBearingDeg,
      });
    }
  }
  return signs.sort((a, b) => a.number - b.number);
}

function nearSign(signs: readonly Signpost[], x: number, z: number, room: number) {
  return signs.some((sign) => Math.abs(x - sign.x) < 1.1 + room && Math.abs(z - sign.z) < 0.4 + room);
}

export function planTown(input: TownInput): TownPlan {
  const kit = BIOME_KITS[input.biome];
  const seed = hash(input.place);
  const season = townSeason(input.routes.map((route) => route.date), input.lat);
  const snow = season === "winter" && kit.snowInWinter;
  const waterKind = input.coastal ? "shore" : kit.water;
  const water: Water =
    waterKind === "canal"
      ? { kind: "canal", ...CANAL, bridgeX: MAIN_X }
      : waterKind === "creek"
        ? { kind: "creek", ...CREEK, bridgeX: MAIN_X }
        : waterKind === "shore"
          ? { kind: "shore", ...SHORE, jettyX: MAIN_X }
          : { kind: "none" };
  const pond = kit.pond ? { ...POND } : null;
  const paths = buildPaths(water.kind);
  const plan = { paths };

  const kinds = input.biome === "city" ? cityHouses(input.lat, input.lng) : [...kit.houses, ...(input.coastal ? kit.coastHouses ?? [] : [])];
  const houses = buildHouses(kinds, houseCount(input.routes.length), seed);
  const wide = houses.some((house) => house.id === "L" || house.id === "R");
  const bounds = { x0: wide ? -9.6 : -7.1, x1: wide ? 9.6 : 7.1, z0: -9.3, z1: 9.8 };
  const signposts = buildSignposts(input.routes);

  const ground: GroundPalette = { ...kit.ground, ...(kit.seasonGround?.[season] ?? {}), ...(snow ? SNOW_GROUND : {}) };
  const canopy = kit.canopy[season];
  const accents = kit.accents[season];
  const accentShift = seed % accents.length;
  const accentOf = (slot: number) => accents[(slot + accentShift) % accents.length];

  const inWater = (x: number, z: number, pad: number) => {
    if (water.kind === "canal" || water.kind === "creek") return z > water.z0 - pad && z < water.z1 + pad;
    if (water.kind === "shore") return z > water.sand - 0.25 - pad;
    return false;
  };
  const inPond = (x: number, z: number, pad: number) => pond !== null && Math.abs(x - pond.x) < pond.w / 2 + pad && Math.abs(z - pond.z) < pond.d / 2 + pad;
  const forestDepth = (x: number, z: number) => {
    let inner: number;
    if (z > CANAL.z1 + 0.3) inner = 16.3 - z;
    else {
      const dx = Math.max(bounds.x0 - x, x - bounds.x1);
      const dz = bounds.z0 - z;
      inner = -Math.max(dx, dz);
    }
    return -inner + (valueNoise(x * 0.55, z * 0.55, 7) - 0.5) * 1.6;
  };
  const clearOf = (x: number, z: number, pad: number) =>
    pathDistance(plan, x, z) > pad && !inHouses(houses, x, z, 0.35) && !inWater(x, z, 0.4) && !inPond(x, z, 0.5) && !nearSign(signposts, x, z, 0.3);

  // ---- feature trees: the template's hand-placed spots
  const trees: Array<Omit<Tree, "rank">> = [];
  for (const [fx, fz, slot, scale] of FEATURE_TREES) {
    const x = round(fx + (h2(seed % 7919, Math.round(fx * 10), 51) - 0.5) * 0.4);
    const z = round(fz + (h2(seed % 7919, Math.round(fz * 10), 52) - 0.5) * 0.4);
    if (!clearOf(x, z, 0.45)) continue;
    trees.push({ x, z, species: accentOf(slot), scale, feature: true });
  }

  // ---- filler: forest, grove, fields' shelterbelts, or city blocks
  const blocks: Block[] = [];
  if (kit.filler === "forest" || kit.filler === "grove") {
    const sp = kit.spacing;
    const filler: Array<Omit<Tree, "rank">> = [];
    for (let gz = -36; gz < 31; gz += sp) {
      for (let gx = -24; gx < 24; gx += sp) {
        const ix = Math.round(gx * 10);
        const iz = Math.round(gz * 10);
        const x = round(gx + (h2(ix, iz, 3) - 0.5) * sp * 0.8);
        const z = round(gz + (h2(ix, iz, 4) - 0.5) * sp * 0.8);
        if (water.kind === "shore" && z > water.sand - 0.6) continue;
        if ((water.kind === "canal" || water.kind === "creek") && z > water.z0 - 1.1 && z < water.z1 + 0.9) continue;
        const depth = forestDepth(x, z);
        if (depth < 0.15) continue;
        if (pathDistance(plan, x, z) < 0.75 || inHouses(houses, x, z, 0.6) || inPond(x, z, 0.6)) continue;
        if (kit.clearing > 0 && valueNoise(x * 0.32, z * 0.32, (seed % 997) + 9) < kit.clearing) continue;
        const r = h2(Math.round(gx * 7), Math.round(gz * 7), 9);
        const edge = depth < 1.0;
        let species: TreeSpecies = canopy;
        if (edge ? r < 0.2 : r < 0.02) species = accentOf(Math.floor(r * 50));
        if (species !== canopy && trees.concat(filler).some((other) => other.species !== canopy && (other.x - x) ** 2 + (other.z - z) ** 2 < 4.4)) species = canopy;
        const scale = species === canopy ? 0.62 + h2(Math.round(gx * 3), Math.round(gz * 3), 5) * 0.3 : 0.62 + h2(Math.round(gx), Math.round(gz), 6) * 0.22;
        filler.push({ x, z, species, scale: round(scale), feature: false });
      }
    }
    // Keep a canopy tree from growing through a broad accent tree.
    const broad = trees.concat(filler).filter((tree) => tree.species !== canopy);
    for (const tree of filler) {
      if (tree.species === canopy && broad.some((other) => (tree.x - other.x) ** 2 + (tree.z - other.z) ** 2 < (1.15 * other.scale + 0.45 * tree.scale) ** 2)) continue;
      trees.push(tree);
    }
  } else if (kit.filler === "fields") {
    // Shelterbelts: rows of trees along the field edges.
    const rows: Array<[number, number, number, number]> = [
      [bounds.x0 - 1.4, -30, bounds.x0 - 1.4, 8],
      [bounds.x1 + 1.4, -30, bounds.x1 + 1.4, 8],
      [-24, bounds.z0 - 1.6, 24, bounds.z0 - 1.6],
      [-24, -21, 24, -21],
      [-17, -30, -17, 8],
      [17, -30, 17, 8],
    ];
    rows.forEach(([ax, az, bx, bz], row) => {
      const length = Math.hypot(bx - ax, bz - az);
      const count = Math.floor(length / 0.95);
      for (let i = 0; i <= count; i += 1) {
        const f = i / count;
        const x = round(ax + (bx - ax) * f + (h2(row, i, 61) - 0.5) * 0.2);
        const z = round(az + (bz - az) * f + (h2(row, i, 62) - 0.5) * 0.2);
        if (!clearOf(x, z, 0.6)) continue;
        if (h2(row, i, 63) < 0.08) continue;
        trees.push({ x, z, species: canopy, scale: round(0.7 + h2(row, i, 64) * 0.25), feature: false });
      }
    });
  } else {
    // Blocks: the city beyond the town, with street trees along the roads.
    const sp = kit.spacing;
    for (let gz = -34; gz < 30; gz += sp) {
      for (let gx = -26; gx < 26; gx += sp) {
        const x = round(gx + (h2(Math.round(gx * 10), Math.round(gz * 10), 71) - 0.5) * 0.3);
        const z = round(gz + (h2(Math.round(gx * 10), Math.round(gz * 10), 72) - 0.5) * 0.3);
        if (forestDepth(x, z) < 0.9) continue;
        if (pathDistance(plan, x, z) < 1.9 || inWater(x, z, 1.6)) continue;
        if (h2(Math.round(gx * 3), Math.round(gz * 3), 73) < kit.clearing) continue;
        const tall = valueNoise(x * 0.12, z * 0.12, (seed % 991) + 3);
        blocks.push({
          x,
          z,
          w: round(sp * (0.7 + h2(Math.round(gx), Math.round(gz), 74) * 0.16)),
          d: round(sp * (0.7 + h2(Math.round(gx), Math.round(gz), 75) * 0.16)),
          h: round(2.4 + tall * tall * 9 + h2(Math.round(gx), Math.round(gz), 76) * 1.5),
          tone: round(h2(Math.round(gx), Math.round(gz), 77)),
        });
      }
    }
    for (const segment of paths.filter((path) => Math.hypot(path.x2 - path.x1, path.z2 - path.z1) > 20)) {
      const length = Math.hypot(segment.x2 - segment.x1, segment.z2 - segment.z1);
      const nx = -(segment.z2 - segment.z1) / length;
      const nz = (segment.x2 - segment.x1) / length;
      for (let d = 1; d < length; d += 1.7) {
        for (const sideSign of [-1, 1]) {
          const x = round(segment.x1 + ((segment.x2 - segment.x1) * d) / length + nx * (segment.hw + 0.55) * sideSign);
          const z = round(segment.z1 + ((segment.z2 - segment.z1) * d) / length + nz * (segment.hw + 0.55) * sideSign);
          if (forestDepth(x, z) < 0.2 || !clearOf(x, z, 0.3)) continue;
          trees.push({ x, z, species: canopy, scale: 0.55, feature: false });
        }
      }
    }
  }

  // Features first; then the rest from the town outwards.
  const ranked: Tree[] = [
    ...trees.filter((tree) => tree.feature),
    ...trees.filter((tree) => !tree.feature).sort((a, b) => Math.hypot(a.x, a.z * 1.2) - Math.hypot(b.x, b.z * 1.2) || a.x - b.x || a.z - b.z),
  ].map((tree, rank) => ({ ...tree, rank }));

  // ---- props
  const props: Prop[] = [];
  const garden = { x0: -4.15, x1: -1.45, z0: 0.75, z1: 2.65 };
  const gardenClear = !inHouses(houses, (garden.x0 + garden.x1) / 2, (garden.z0 + garden.z1) / 2, 0.8);
  if (kit.bed !== "none" && gardenClear) {
    props.push(
      { kind: "fence", x1: garden.x0, z1: garden.z0, x2: garden.x1, z2: garden.z0 },
      { kind: "fence", x1: garden.x0, z1: garden.z0, x2: garden.x0, z2: garden.z1 },
      { kind: "fence", x1: garden.x1, z1: garden.z0, x2: garden.x1, z2: garden.z1 },
      { kind: "bed", bed: kit.bed, x: (garden.x0 + garden.x1) / 2, z: (garden.z0 + garden.z1) / 2 + 0.05, w: 2.5, d: 1.6 },
    );
  }
  if (pond) props.push({ kind: "fence", x1: -6.4, z1: 4.75, x2: -0.3, z2: 4.75 });
  props.push({ kind: "fence", x1: 4.3, z1: -5.6, x2: 6.3, z2: -5.6 });
  SHRUBS.forEach(([x, z], index) => {
    if (inHouses(houses, x, z, 0.2) || pathDistance(plan, x, z) < 0.05) return;
    props.push({ kind: "shrub", x, z, s: round(0.32 + h2(index, 9, 321) * 0.08) });
  });
  props.push({ kind: "bench", x: -0.4, z: pond ? 5.35 : 5.0 });
  props.push({ kind: "corner", corner: kit.corner, x: 2.75, z: 4.75 });
  props.push({ kind: "pole", x: 5.9, z: 4.75 });

  const loop = runnerLoop();
  const base: TownPlan = {
    place: input.place,
    seed,
    biome: input.biome,
    season,
    snow,
    canopy,
    filler: kit.filler,
    field: kit.field,
    backdrop: kit.backdrop,
    ground,
    shrub: kit.shrub,
    water,
    pond,
    loop: { ...LOOP },
    paths,
    bounds,
    houses,
    trees: ranked,
    blocks,
    props,
    signposts,
    spawn: pointAlong(loop, 0.995),
    runnerLoop: loop,
    timeOfDay: "golden",
    residents: [],
  };
  return { ...base, residents: placeResidents(base, input.residents ?? []) };
}

// ---------------------------------------------------------------- residents

function spotCandidates(plan: TownPlan, spot: ResidentSpot): Array<{ x: number; z: number }> {
  switch (spot) {
    case "plaza":
      return [{ x: 0.6, z: 1.9 }, { x: -0.2, z: 2.7 }, { x: 1.5, z: 2.8 }, { x: 0.9, z: 1.0 }];
    case "pond":
      return plan.pond
        ? [
            { x: plan.pond.x + plan.pond.w / 2 + 0.6, z: plan.pond.z },
            { x: plan.pond.x, z: plan.pond.z - plan.pond.d / 2 - 0.55 },
            { x: plan.pond.x - plan.pond.w / 2 - 0.5, z: plan.pond.z - 0.4 },
          ]
        : spotCandidates(plan, "plaza");
    case "signposts":
      return [{ x: 0.4, z: 7.8 }, { x: 2.7, z: 7.8 }, { x: -2.3, z: 7.7 }];
    case "porch":
      return plan.houses.map((house) => ({ x: house.x, z: round(house.z + house.depth / 2 + 0.6) }));
    case "water":
      if (plan.water.kind === "canal" || plan.water.kind === "creek") return [-4, 0, 4].map((x) => ({ x, z: round(plan.water.kind === "none" ? 0 : (plan.water as { z0: number }).z0 - 0.45) }));
      if (plan.water.kind === "shore") return [-4, 0, 4].map((x) => ({ x, z: round((plan.water as { sand: number }).sand + 0.6) }));
      return spotCandidates(plan, "plaza");
    case "edge":
      return [{ x: plan.bounds.x0 + 0.6, z: 2 }, { x: plan.bounds.x1 - 0.6, z: 1.5 }, { x: 0, z: plan.bounds.z0 + 0.6 }];
    case "path":
    default:
      return [0.1, 0.35, 0.6, 0.85].map((fraction) => pointAlong(plan.runnerLoop, fraction));
  }
}

function placeResidents(plan: TownPlan, residents: readonly TownResident[]): ResidentPlacement[] {
  const taken: Array<{ x: number; z: number }> = [];
  return residents.map((resident) => {
    const spot: ResidentSpot = (RESIDENT_SPOTS as readonly string[]).includes(resident.spot) ? resident.spot : "path";
    const candidates = spotCandidates(plan, spot);
    let place = candidates.find((candidate) => taken.every((other) => Math.hypot(other.x - candidate.x, other.z - candidate.z) > 0.8));
    if (!place) {
      const first = candidates[0];
      place = { x: round(first.x + 0.9 * taken.length), z: first.z };
    }
    taken.push(place);
    return { ...resident, spot, x: place.x, z: place.z };
  });
}

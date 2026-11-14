import type { ExploredId } from "@/labs/sketch/sketch-tile";
import { nearBuildings } from "@/labs/sketch/sketch-faces";
import { matchLandmarks, pointInRing, toriiFrom } from "@/labs/sketch/sketch-form";
import { buildingMass, packFaces } from "@/labs/sketch/sketch-massing";
import { regionAt } from "@/labs/sketch/sketch-region";
import { treesIn } from "@/labs/sketch/sketch-trees";
import { REVEAL_LAYERS, dropTileEdges, exploredIds, readBuildings, readContext } from "@/labs/sketch/sketch-tile";

/** Colours per region's palette (see the facade shader). */
const PALETTE_SIZE = 8;

// One building tile made into drawings: pure, so it runs in the worker, in
// tests and in a benchmark alike. Plan coordinates are tile units.

export interface TileReveal {
  lines: [number, number][][];
  radiusM: number;
  fade: boolean;
  version: number;
}

function join(parts: Float32Array[]) {
  const all = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    all.set(part, offset);
    offset += part.length;
  }
  return all;
}

export function buildTile(data: Uint8Array, key: string, reveal: TileReveal | null) {
  const [z, x, y] = key.split("/").map(Number);
  const n = 2 ** z;
  const buildings = readBuildings(data);
  const extent = buildings[0]?.extent ?? 4096;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n))) * 180) / Math.PI;
  const lng = ((x + 0.5) / n) * 360 - 180;
  const metresPerUnit = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / n / extent;
  const region = regionAt(lng, lat);
  const context = readContext(data);
  const landmarks = matchLandmarks(buildings, context.worship);
  // Land use by box first, then by ring.
  const uses = context.landuse.map((area) => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [px, py] of area.ring) {
      x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
    }
    return { ...area, x0, x1, y0, y1 };
  });
  const landuseAt = ([px, py]: number[]) => uses.find((area) => px >= area.x0 && px <= area.x1 && py >= area.y0 && py <= area.y1 && pointInRing(px, py, area.ring))?.cls;

  // Neighbours' heights, by 100 m cell, for the height rule. Only heights
  // the data really gives (taller than the 7.5 m it may default to) count, and
  // only a building whose own height is invented asks for them.
  const cell = 100 / metresPerUnit;
  const grid = new Map<number, number[]>();
  const cellKey = (cx: number, cy: number) => cx * 4096 + cy;
  const centres = buildings.map(({ rings: [ring] }) => {
    let sx = 0;
    let sy = 0;
    for (const [px, py] of ring) {
      sx += px;
      sy += py;
    }
    return [sx / ring.length, sy / ring.length];
  });
  buildings.forEach((building, index) => {
    if (building.height <= 7.5) return;
    const k = cellKey(Math.floor(centres[index][0] / cell), Math.floor(centres[index][1] / cell));
    const list = grid.get(k);
    if (list) list.push(building.height);
    else grid.set(k, [building.height]);
  });
  const NONE: number[] = [];
  const neighboursOf = (index: number) => {
    if (buildings[index].height > 7.5) return NONE;
    const cx = Math.floor(centres[index][0] / cell);
    const cy = Math.floor(centres[index][1] / cell);
    const out: number[] = [];
    for (let dy = -1; dy <= 1; dy += 1)
      for (let dx = -1; dx <= 1; dx += 1) {
        const list = grid.get(cellKey(cx + dx, cy + dy));
        if (list) for (const h of list) out.push(h);
      }
    return out;
  };

  // Her routes in this tile's units, for the reveal.
  let lines: [number, number][][] = [];
  let radius = 0;
  const strength = new Map<object, number>();
  let explored: ExploredId[] = [];
  if (reveal) {
    const toTile = ([lo, la]: [number, number]): [number, number] => {
      const s = Math.sin((la * Math.PI) / 180);
      return [(((lo + 180) / 360) * n - x) * extent, ((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n - y) * extent];
    };
    lines = reveal.lines.map((line) => line.map(toTile));
    radius = reveal.radiusM / metresPerUnit;
    explored = exploredIds(data, lines, radius, REVEAL_LAYERS);
    for (const { building, strength: value } of nearBuildings(buildings, lines, radius)) strength.set(building, reveal.fade ? value : 1);
  }

  const faces: Float32Array[] = [];
  const edges: Float32Array[] = [];
  buildings.forEach((building, index) => {
    const ring = building.rings[0];
    const clipped = ring.some(([px, py]) => px < 0 || py < 0 || px > extent || py > extent);
    // A seed from the building's place in the world, the same in any tile.
    const seed = Math.round((x * extent + centres[index][0]) * 13 + (y * extent + centres[index][1]) * 7) | 0;
    const revealed = strength.get(building);
    const mass = buildingMass(building, {
      metresPerUnit,
      region,
      seed,
      neighbours: neighboursOf(index),
      clipped,
      landuse: uses.length ? landuseAt(centres[index]) : undefined,
      landmark: landmarks.get(index),
      explored: revealed ? { strength: revealed, colour: Math.abs(seed) % PALETTE_SIZE } : undefined,
    });
    faces.push(mass.faces);
    edges.push(mass.edges);
  });
  // Trees where the data has parks and woods: their places are invented, the parks are not.
  edges.push(treesIn(context.parks, { metresPerUnit, seed: x * 92821 + y * 68917 }));
  edges.push(treesIn(context.gardens, { metresPerUnit, seed: x * 31337 + y * 7919, shrubs: true }));
  // Torii at gates by shrines, in ink only: two posts, the top beam and the tie beam.
  if (region === "japan") {
    const shrines = context.worship.filter((poi) => poi.subclass === "shinto");
    const torii: number[] = [];
    for (const { x: tx, y: ty, angle } of toriiFrom(context.gates, shrines, metresPerUnit)) {
      const along = (d: number): [number, number] => [tx + (Math.cos(angle) * d) / metresPerUnit, ty + (Math.sin(angle) * d) / metresPerUnit];
      const [l, r, ll, rr, nl, nr] = [along(-1.8), along(1.8), along(-2.8), along(2.8), along(-2.2), along(2.2)];
      torii.push(l[0], l[1], 0, l[0], l[1], 4.6, r[0], r[1], 0, r[0], r[1], 4.6);
      torii.push(ll[0], ll[1], 4.9, rr[0], rr[1], 4.9, ll[0], ll[1], 4.6, rr[0], rr[1], 4.6, nl[0], nl[1], 3.8, nr[0], nr[1], 3.8);
    }
    edges.push(new Float32Array(torii));
  }
  const allEdges = dropTileEdges(join(edges), extent);
  const allFaces = packFaces(join(faces));
  return { edges: allEdges, faces: allFaces, extent, explored, version: reveal?.version ?? 0, buildings: buildings.length };
}

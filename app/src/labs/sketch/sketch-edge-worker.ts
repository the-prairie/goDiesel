// Off the main thread: fetches a building tile and turns each footprint into
// a drawn building (see sketch-massing: heights, roofs and facade storeys
// are INVENTED by rule where the open data has none), its faces and its ink
// edges, ready to upload; finds the trees to draw in its parks; and, for the
// colour reveal, names the water and parks near her routes. A dense city
// tile holds tens of thousands of buildings, too much to work on between
// frames.

import { BUILDING_COLOURS, nearBuildings } from "@/labs/sketch/sketch-faces";
import { buildingMass, packFaces, type Region } from "@/labs/sketch/sketch-massing";
import { treesIn } from "@/labs/sketch/sketch-trees";
import { REVEAL_LAYERS, dropTileEdges, exploredIds, readBuildings, readParks, type ExploredId } from "@/labs/sketch/sketch-tile";

export interface EdgeRequest {
  key: string;
  url: string;
  /** Her routes and how far colour reaches, at this version of the reveal; null for none. */
  reveal: { lines: [number, number][][]; radiusM: number; fade: boolean; version: number } | null;
}

export type EdgeResponse =
  | { key: string; edges: Float32Array; faces: ArrayBuffer; extent: number; explored: ExploredId[]; version: number; buildings: number }
  | { key: string; error: string };

const scope = self as unknown as { onmessage: ((event: MessageEvent<EdgeRequest>) => void) | null; postMessage: (message: EdgeResponse, transfer?: Transferable[]) => void };

function join(parts: Float32Array[]) {
  const all = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    all.set(part, offset);
    offset += part.length;
  }
  return all;
}

scope.onmessage = async (event) => {
  const { key, url, reveal } = event.data;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = new Uint8Array(await response.arrayBuffer());
    const [z, x, y] = key.split("/").map(Number);
    const n = 2 ** z;
    const buildings = readBuildings(data);
    const extent = buildings[0]?.extent ?? 4096;
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n))) * 180) / Math.PI;
    const lng = ((x + 0.5) / n) * 360 - 180;
    const metresPerUnit = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / n / extent;
    const region: Region = lng > 122 && lng < 154 && lat > 24 && lat < 46 ? "japan" : "other";

    // Neighbours' heights, by 100 m cell, for the height rule.
    const cell = 100 / metresPerUnit;
    const grid = new Map<string, number[]>();
    const centre = (ring: [number, number][]) => ring.reduce((sum, p) => [sum[0] + p[0] / ring.length, sum[1] + p[1] / ring.length], [0, 0]);
    const centres = buildings.map((building) => centre(building.rings[0]));
    buildings.forEach((building, index) => {
      const cellKey = `${Math.floor(centres[index][0] / cell)},${Math.floor(centres[index][1] / cell)}`;
      const list = grid.get(cellKey) ?? [];
      list.push(building.height);
      grid.set(cellKey, list);
    });
    const neighboursOf = (index: number) => {
      const [cx, cy] = [Math.floor(centres[index][0] / cell), Math.floor(centres[index][1] / cell)];
      const out: number[] = [];
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) out.push(...(grid.get(`${cx + dx},${cy + dy}`) ?? []));
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
        explored: revealed ? { strength: revealed, colour: Math.abs(seed) % BUILDING_COLOURS.length } : undefined,
      });
      faces.push(mass.faces);
      edges.push(mass.edges);
    });
    // Trees where the data has parks and woods: their places are invented, the parks are not.
    edges.push(treesIn(readParks(data), { metresPerUnit, seed: x * 92821 + y * 68917 }));
    const allEdges = dropTileEdges(join(edges), extent);
    const allFaces = packFaces(join(faces));
    scope.postMessage({ key, edges: allEdges, faces: allFaces, extent, explored, version: reveal?.version ?? 0, buildings: buildings.length }, [allEdges.buffer, allFaces]);
  } catch (error) {
    scope.postMessage({ key, error: error instanceof Error ? error.message : String(error) });
  }
};

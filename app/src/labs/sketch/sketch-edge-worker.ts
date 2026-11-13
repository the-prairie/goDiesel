// Off the main thread: fetches a tile, reads its building footprints and
// returns their drawn edges, ready to upload, and names the features that
// lie near her routes, for the colour reveal. A dense city tile holds tens
// of thousands of buildings, too much to read between frames.

import { buildingEdges } from "@/labs/sketch/sketch-edges";
import { BUILDING_COLOURS, buildingFaces, nearBuildings } from "@/labs/sketch/sketch-faces";
import { REVEAL_LAYERS, dropTileEdges, exploredIds, readBuildings, type ExploredId } from "@/labs/sketch/sketch-tile";

export interface EdgeRequest {
  key: string;
  url: string;
  /** Whether to read the buildings' edges (a tile already drawn needs only its reveal). */
  edges: boolean;
  /** Her routes, to name the features near them, at this version of the reveal. */
  reveal: { lines: [number, number][][]; radiusM: number; fade: boolean; version: number } | null;
}

export type EdgeResponse =
  | { key: string; edges: Float32Array | null; extent: number; explored: ExploredId[] | null; faces: Float32Array | null; version: number }
  | { key: string; error: string };

const scope = self as unknown as { onmessage: ((event: MessageEvent<EdgeRequest>) => void) | null; postMessage: (message: EdgeResponse, transfer?: Transferable[]) => void };

scope.onmessage = async (event) => {
  const { key, url, reveal } = event.data;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = new Uint8Array(await response.arrayBuffer());
    let edges: Float32Array | null = null;
    let extent = 4096;
    const buildings = event.data.edges || reveal ? readBuildings(data) : [];
    extent = buildings[0]?.extent ?? extent;
    if (event.data.edges) edges = dropTileEdges(join(buildings.map((building) => buildingEdges(building.rings, building.height, building.minHeight))), extent);
    let explored: ExploredId[] | null = null;
    let faces: Float32Array | null = null;
    if (reveal) {
      const [z, x, y] = key.split("/").map(Number);
      const n = 2 ** z;
      const toTile = ([lng, lat]: [number, number]): [number, number] => {
        const s = Math.sin((lat * Math.PI) / 180);
        return [(((lng + 180) / 360) * n - x) * extent, ((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n - y) * extent];
      };
      const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n))) * 180) / Math.PI;
      const metresPerUnit = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / n / extent;
      const lines = reveal.lines.map((line) => line.map(toTile));
      const radius = reveal.radiusM / metresPerUnit;
      explored = exploredIds(data, lines, radius, REVEAL_LAYERS);
      faces = join(
        nearBuildings(buildings, lines, radius).map(({ building, strength }) => {
          const [x0, y0] = building.rings[0][0];
          const colour = BUILDING_COLOURS[Math.abs(Math.round(x0 * 7 + y0 * 13)) % BUILDING_COLOURS.length];
          return buildingFaces(building, colour, reveal.fade ? strength : 1);
        }),
      );
    }
    const transfer = [edges?.buffer, faces?.buffer].filter((buffer): buffer is ArrayBuffer => buffer !== undefined);
    scope.postMessage({ key, edges, extent, explored, faces, version: reveal?.version ?? 0 }, transfer);
  } catch (error) {
    scope.postMessage({ key, error: error instanceof Error ? error.message : String(error) });
  }
};

function join(parts: Float32Array[]) {
  const all = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    all.set(part, offset);
    offset += part.length;
  }
  return all;
}

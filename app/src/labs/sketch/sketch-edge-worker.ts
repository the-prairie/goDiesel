// Off the main thread: fetches a building tile and turns each footprint into
// a drawn building (see sketch-massing: heights, roofs and facade storeys
// are INVENTED by rule where the open data has none), its faces and its ink
// edges, ready to upload; finds the trees to draw in its parks; and, for the
// colour reveal, names the water and parks near her routes. A dense city
// tile holds tens of thousands of buildings, too much to work on between
// frames.

import { buildTile } from "@/labs/sketch/sketch-tile-build";
import type { ExploredId } from "@/labs/sketch/sketch-tile";

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

scope.onmessage = async (event) => {
  const { key, url, reveal } = event.data;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const made = buildTile(new Uint8Array(await response.arrayBuffer()), key, reveal);
    scope.postMessage({ key, ...made }, [made.edges.buffer, made.faces]);
  } catch (error) {
    scope.postMessage({ key, error: error instanceof Error ? error.message : String(error) });
  }
};

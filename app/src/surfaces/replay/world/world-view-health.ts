import { Mesh, Raycaster, Vector2, type PerspectiveCamera } from "three";
import type { TilesRenderer } from "3d-tiles-renderer/three";

export interface WorldViewCoverage {
  sampledAtMs: number | null;
  tested: number;
  hits: number;
  centerHit: boolean;
}
export const EMPTY_VIEW_COVERAGE: WorldViewCoverage = { sampledAtMs: null, tested: 0, hits: 0, centerHit: false };
export type WorldViewState = "entering" | "missing" | "recovering" | "refining" | "ready";

/** Five surface probes, not a percentage of imagery pixels or a label-alignment score. */
export function sampleWorldView(tiles: TilesRenderer, camera: PerspectiveCamera, now: number): WorldViewCoverage {
  const meshes: Mesh[] = [];
  tiles.forEachLoadedModel((model, tile) => {
    if (tiles.visibleTiles.has(tile)) model.traverseVisible(object => { if (object instanceof Mesh) meshes.push(object); });
  });
  const ray = new Raycaster(); ray.firstHitOnly = true;
  // Keep the probes around the route subject, not the intentional sky/horizon.
  const probes = [[0, 0], [-0.45, -0.2], [0.45, -0.2], [-0.25, 0.2], [0.25, 0.2]];
  let hits = 0, centerHit = false;
  for (const [i, [x, y]] of probes.entries()) {
    ray.setFromCamera(new Vector2(x, y), camera);
    const hit = ray.intersectObjects(meshes, false)[0];
    if (hit) { hits++; if (i === 0) centerHit = true; }
  }
  return { sampledAtMs: now, tested: probes.length, hits, centerHit };
}

export function currentWorldView(started: boolean, meshes: number, coverage: WorldViewCoverage, now: number, refining: boolean): WorldViewState {
  if (!started) return "entering";
  if (meshes <= 0) return "missing";
  if (coverage.sampledAtMs === null || now - coverage.sampledAtMs > 800) return "recovering";
  if (!coverage.centerHit) return "missing";
  if (coverage.hits < coverage.tested) return "recovering";
  return refining ? "refining" : "ready";
}

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

/** Fifteen surface probes, not a percentage of imagery pixels or a label-alignment score. */
export function sampleWorldView(tiles: TilesRenderer, camera: PerspectiveCamera, now: number): WorldViewCoverage {
  const meshes: Mesh[] = [];
  tiles.forEachLoadedModel((model, tile) => {
    if (tiles.visibleTiles.has(tile)) model.traverseVisible(object => { if (object instanceof Mesh) meshes.push(object); });
  });
  return sampleWorldMeshes(meshes, camera, now);
}

export function sampleWorldMeshes(meshes: Mesh[], camera: PerspectiveCamera, now: number): WorldViewCoverage {
  const ray = new Raycaster(); ray.firstHitOnly = true;
  // Keep the probes around the route subject, not the intentional sky/horizon.
  const probes = [[0, 0], ...[-0.45, 0, 0.4].flatMap(y =>
    [-0.8, -0.4, 0, 0.4, 0.8].filter(x => x !== 0 || y !== 0).map(x => [x, y]))];
  ray.near = camera.near; ray.far = camera.far;
  let hits = 0, tested = 0, centerHit = false;
  for (const [i, [x, y]] of probes.entries()) {
    ray.setFromCamera(new Vector2(x, y), camera);
    // Above-horizon rays are intentional sky, not missing terrain. Camera.up is
    // the local geodetic vertical set by WorldFrame, not the screen's up vector.
    if (i !== 0 && ray.ray.direction.dot(camera.up) >= -0.005) continue;
    tested++;
    const hit = ray.intersectObjects(meshes, false)[0];
    if (hit) { hits++; if (i === 0) centerHit = true; }
  }
  return { sampledAtMs: now, tested, hits, centerHit };
}

export function currentWorldView(started: boolean, meshes: number, coverage: WorldViewCoverage, now: number, refining: boolean): WorldViewState {
  if (!started) return "entering";
  if (meshes <= 0) return "missing";
  if (coverage.sampledAtMs === null || now - coverage.sampledAtMs > 800) return "recovering";
  if (!coverage.centerHit) return "missing";
  if (coverage.hits < coverage.tested) return "recovering";
  return refining ? "refining" : "ready";
}

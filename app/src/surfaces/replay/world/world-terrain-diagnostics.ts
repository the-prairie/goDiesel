import { Mesh, PerspectiveCamera, Raycaster, Vector2 } from "three";
import type { TilesRenderer } from "3d-tiles-renderer/three";

export type FocusReason = "not-sampled" | "no-visible-terrain" | "no-center-ray-hit" | "missing-geometric-error" | "sample-error" | "available";
export interface TerrainFocusSample {
  sampledAtMs: number | null;
  reason: FocusReason;
  geometricErrorM: number | null;
  distanceM: number | null;
  estimatedScreenErrorPx: number | null;
  selectionTargetPx: number | null;
}
export const emptyTerrainFocus = (): TerrainFocusSample => ({
  sampledAtMs: null, reason: "not-sampled", geometricErrorM: null,
  distanceM: null, estimatedScreenErrorPx: null, selectionTargetPx: null,
});
/** Estimate at the center-ray surface, NOT the library's bounding-volume SSE or GPS accuracy. */
export function estimateFocusErrorPx(errorM: number, distanceM: number, projectionY: number, resolutionHeight: number) {
  if (![errorM, distanceM, projectionY, resolutionHeight].every(Number.isFinite) || errorM < 0 || distanceM <= 0 || projectionY <= 0 || resolutionHeight <= 0) return null;
  return errorM * projectionY * resolutionHeight / (2 * distanceM);
}

/** Read only the selected terrain. Do not raycast route lines, labels or invisible cached tiles. */
export function sampleTerrainFocus(tiles: TilesRenderer | undefined, camera: PerspectiveCamera, now: number, resolutionHeight: number): TerrainFocusSample {
  const result = { ...emptyTerrainFocus(), sampledAtMs: now, selectionTargetPx: tiles?.errorTarget ?? null };
  if (!tiles?.visibleTiles.size) return { ...result, reason: "no-visible-terrain" };
  const ray = new Raycaster(); ray.firstHitOnly = true;
  ray.setFromCamera(new Vector2(0, 0), camera);
  const meshes: Mesh[] = [];
  const errors = new WeakMap<Mesh, number>();
  tiles.forEachLoadedModel((model, tile) => {
    if (!tiles.visibleTiles.has(tile)) return;
    model.traverseVisible((object) => {
      if (object instanceof Mesh) { meshes.push(object); errors.set(object, tile.geometricError); }
    });
  });
  const hit = ray.intersectObjects(meshes, false)[0];
  if (!hit) return { ...result, reason: "no-center-ray-hit" };
  const error = errors.get(hit.object as Mesh);
  if (error === undefined || !Number.isFinite(error) || error < 0) return { ...result, reason: "missing-geometric-error", distanceM: hit.distance };
  // Pinned TilesRenderer.setResolutionFromRenderer uses renderer.getSize (CSS pixels),
  // not the drawing-buffer size. Match that selection metric without changing it.
  return {
    ...result, reason: "available", geometricErrorM: error, distanceM: hit.distance,
    estimatedScreenErrorPx: estimateFocusErrorPx(error, hit.distance, camera.projectionMatrix.elements[5], resolutionHeight),
  };
}

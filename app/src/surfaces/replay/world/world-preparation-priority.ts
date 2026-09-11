import { Matrix4, type PerspectiveCamera } from "three";
import { ExtendedFrustum } from "3d-tiles-renderer/src/three/renderer/math/ExtendedFrustum.js";
import type { Tile } from "3d-tiles-renderer/core";
import type { TilesRenderer } from "3d-tiles-renderer/three";
import type { WorldSupportRegion } from "./world-support-region";

type Queue = Pick<TilesRenderer["parseQueue"], "priorityCallback">;
interface TileVolume {
  intersectsFrustum(frustum: ExtendedFrustum): boolean;
  intersectsOBB(...args: unknown[]): boolean;
}
export interface WorldPreparationPriorityView {
  camera: PerspectiveCamera;
  criticalRegions: WorldSupportRegion[];
  focusRegions: WorldSupportRegion[];
}

/**
 * Temporary shot-acquisition priority. It never adds queue slots, cache space,
 * or provider concurrency; it only decides which already-eligible work wins.
 * Collision/route support > destination footprint > destination frustum >
 * unrelated scenery. The pinned renderer still breaks ties inside each class.
 */
export class WorldPreparationPriority {
  private views: Array<{ frustum: ExtendedFrustum; criticalRegions: WorldSupportRegion[]; focusRegions: WorldSupportRegion[] }> = [];
  private scores = new WeakMap<Tile, number>();
  private readonly restore: Array<() => void> = [];
  constructor(tiles: TilesRenderer) {
    for (const queue of [tiles.downloadQueue, tiles.parseQueue, tiles.processNodeQueue] as Queue[]) {
      const original = queue.priorityCallback;
      const compare = (a: Tile, b: Tile) => this.score(a) - this.score(b) || original?.(a, b) || 0;
      queue.priorityCallback = compare;
      this.restore.push(() => { if (queue.priorityCallback === compare) queue.priorityCallback = original; });
    }
  }
  update(candidates: WorldPreparationPriorityView[], tilesToWorld: Matrix4) {
    this.scores = new WeakMap();
    this.views = candidates.map(({ camera, criticalRegions, focusRegions }) => ({
      // Pinned OBB intersection needs corners as well as planes; a native
      // Three Frustum silently satisfies its declaration but throws at runtime.
      // Provider bounds are in tileset coordinates; cameras are in local ENU.
      frustum: new ExtendedFrustum().setFromProjectionMatrix(new Matrix4()
        .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(tilesToWorld)),
      criticalRegions,
      focusRegions,
    }));
  }
  private score(tile: Tile) {
    const cached=this.scores.get(tile);if(cached!==undefined)return cached;
    const volume = (tile as Tile & { engineData?: { boundingVolume?: TileVolume } }).engineData?.boundingVolume;
    if (!volume) return 0;
    let score = 0;
    for (const view of this.views) {
      if (view.criticalRegions.some(region => region.intersectsTile(volume as never, tile, null as never))) {score=3;break;}
      const visible = volume.intersectsFrustum(view.frustum);
      // A circular route footprint extends behind and beside the camera. Only the
      // portion that can contribute to the requested picture outranks other
      // visible terrain; off-camera focus work can use otherwise-idle capacity.
      if (visible && view.focusRegions.some(region => region.intersectsTile(volume as never, tile, null as never))) score=Math.max(score,2);
      else if (visible) score=Math.max(score,1);
    }
    this.scores.set(tile,score);
    return score;
  }
  clear() { this.views = []; this.scores = new WeakMap(); }
  dispose() { this.clear(); this.restore.forEach(restore => restore()); }
}

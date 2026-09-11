import { describe, expect, it, vi } from "vitest";
import { Matrix4, PerspectiveCamera, Vector3 } from "three";
import type { Tile } from "3d-tiles-renderer/core";
import { TilesRenderer } from "3d-tiles-renderer/three";
import { TileBoundingVolume } from "3d-tiles-renderer/src/three/renderer/math/TileBoundingVolume.js";
import { WorldFrame } from "./world-frame";
import { WorldPreparationPriority } from "./world-preparation-priority";
import { configureWorldStreaming } from "./world-streaming";
import type { WorldSupportRegion } from "./world-support-region";

describe("selected view work priority", () => {
  it("orders support, destination footprint, destination view, then unrelated scenery", () => {
    const tiles = new TilesRenderer();configureWorldStreaming(tiles);
    const original = vi.fn(() => -7);
    tiles.downloadQueue.priorityCallback = original;tiles.parseQueue.priorityCallback = original;
    const priorities = new WorldPreparationPriority(tiles);
    const camera = new PerspectiveCamera();camera.updateMatrixWorld(true);
    const supportVolume = {intersectsFrustum: () => false},focusVolume={intersectsFrustum:()=>true},offscreenFocusVolume={intersectsFrustum:()=>false};
    const support = {intersectsTile: (volume: unknown) => volume === supportVolume} as unknown as WorldSupportRegion;
    const focus = {intersectsTile: (volume: unknown) => volume === focusVolume || volume === offscreenFocusVolume} as unknown as WorldSupportRegion;
    const tile = (volume: unknown) => ({engineData: {boundingVolume: volume}} as unknown as Tile);
    const ground = tile(supportVolume),footprint=tile(focusVolume),offscreenFootprint=tile(offscreenFocusVolume),view = tile({intersectsFrustum: () => true}), horizon = tile({intersectsFrustum: () => false});
    priorities.update([{camera,criticalRegions:[support],focusRegions:[focus]}], new Matrix4());
    for (const queue of [tiles.downloadQueue, tiles.parseQueue, tiles.processNodeQueue]) {
      expect(queue.priorityCallback!(ground, footprint)).toBeGreaterThan(0);
      expect(queue.priorityCallback!(footprint, view)).toBeGreaterThan(0);
      expect(queue.priorityCallback!(view, offscreenFootprint)).toBeGreaterThan(0);
      expect(queue.priorityCallback!(view, horizon)).toBeGreaterThan(0);
    }
    expect(tiles.downloadQueue.priorityCallback!(ground, ground)).toBe(-7);
    expect(tiles.parseQueue.priorityCallback!(ground, ground)).toBe(-7);
    priorities.clear();expect(tiles.parseQueue.priorityCallback!(view, horizon)).toBe(-7);
    priorities.dispose();expect(tiles.parseQueue.priorityCallback).toBe(original);tiles.dispose();
  });
  it("does not alter shared queues or another instance's comparator", () => {
    const tiles = new TilesRenderer(), other = new TilesRenderer();configureWorldStreaming(tiles);
    const shared = other.parseQueue.priorityCallback;
    const priorities = new WorldPreparationPriority(tiles);
    expect(other.parseQueue.priorityCallback).toBe(shared);
    const newer = vi.fn(() => 0);tiles.parseQueue.priorityCallback = newer;
    priorities.dispose();expect(tiles.parseQueue.priorityCallback).toBe(newer);tiles.dispose();other.dispose();
  });
  it("sorts actual provider OBBs in the camera's ECEF frame without stalling either work queue", () => {
    const tiles=new TilesRenderer();configureWorldStreaming(tiles);
    const priorities=new WorldPreparationPriority(tiles),frame=new WorldFrame(35.2,24.1);
    const camera=new PerspectiveCamera(50,1.5,1,20000);camera.position.set(0,0,200);
    camera.up.set(0,1,0);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
    const tile=(position:Vector3) => {
      const volume=new TileBoundingVolume();
      volume.setObbData([position.x,position.y,position.z,10,0,0,0,10,0,0,0,10],frame.worldToECEF);
      return {engineData:{boundingVolume:volume}} as unknown as Tile;
    };
    const subject=tile(new Vector3()),distant=tile(new Vector3(10000,0,0));
    priorities.update([{camera,criticalRegions:[],focusRegions:[]}],frame.ecefToWorld);
    for(const queue of [tiles.downloadQueue,tiles.parseQueue]) {
      expect(()=>queue.priorityCallback!(subject,distant)).not.toThrow();
      expect(queue.priorityCallback!(subject,distant)).toBeGreaterThan(0);
    }
    priorities.dispose();tiles.dispose();
  });
});

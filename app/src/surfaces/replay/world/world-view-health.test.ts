import { describe, expect, it } from "vitest";
import { currentWorldView, EMPTY_VIEW_COVERAGE, sampleWorldView } from "./world-view-health";
import { Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Scene } from "three";
import type { TilesRenderer } from "3d-tiles-renderer/three";
const full = { sampledAtMs: 1000, tested: 5, hits: 5, centerHit: true };
describe("current landscape coverage", () => {
  it("separates completed startup from a missing current view", () => {
    expect(currentWorldView(true, 0, full, 1100, false)).toBe("missing");
    expect(currentWorldView(true, 100, {...full,centerHit:false}, 1100, false)).toBe("missing");
    expect(currentWorldView(true, 100, {...full,hits:3}, 1100, false)).toBe("recovering");
    expect(currentWorldView(true, 100, full, 1100, true)).toBe("refining");
    expect(currentWorldView(true, 100, full, 1100, false)).toBe("ready");
  });
  it("does not certify a previous camera's expired probe", () => {
    expect(currentWorldView(true, 100, full, 1900, false)).toBe("recovering");
    expect(currentWorldView(true, 100, EMPTY_VIEW_COVERAGE, 1900, false)).toBe("recovering");
  });
  it("intersects actual selected geometry, excluding cached invisible models", () => {
    const scene = new Scene(); const plane = new Mesh(new PlaneGeometry(100,100),new MeshBasicMaterial()); scene.add(plane); scene.updateMatrixWorld(true);
    const camera = new PerspectiveCamera(50,1,0.1,100); camera.position.z = 10; camera.updateMatrixWorld();
    const tile = {}; const visible = new Set([tile]);
    const tiles = { visibleTiles:visible, forEachLoadedModel:(fn:(scene: Scene, tile: object) => void)=>fn(scene,tile) } as unknown as TilesRenderer;
    expect(sampleWorldView(tiles,camera,1000)).toEqual(full);
    visible.clear(); expect(sampleWorldView(tiles,camera,1000).hits).toBe(0);
    plane.geometry.dispose(); plane.material.dispose();
  });
});

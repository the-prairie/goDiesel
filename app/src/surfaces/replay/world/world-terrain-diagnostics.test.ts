import { describe, expect, it } from "vitest";
import { BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera } from "three";
import type { TilesRenderer } from "3d-tiles-renderer/three";
import { estimateFocusErrorPx, sampleTerrainFocus } from "./world-terrain-diagnostics";

function scene() {
  const camera = new PerspectiveCamera(60, 1, 1, 20000); camera.position.z = 1000; camera.updateMatrixWorld();
  const detail = { geometricError: 16 }, coarse = { geometricError: 800 };
  const ground = new Mesh(new BoxGeometry(400, 400, 10), new MeshBasicMaterial()); ground.updateMatrixWorld();
  const hidden = new Mesh(new BoxGeometry(400, 400, 100), new MeshBasicMaterial()); hidden.position.z = 500; hidden.updateMatrixWorld();
  const tiles = { visibleTiles: new Set([detail]), errorTarget: 10, forEachLoadedModel: (callback: (mesh: Mesh, tile: object) => void) => { callback(ground, detail); callback(hidden, coarse); } } as unknown as TilesRenderer;
  return { camera, tiles, ground, hidden, detail };
}
describe("camera-local terrain diagnostics", () => {
  it("estimates projected detail from distance/FOV/resolution, not geographic error", () => {
    expect(estimateFocusErrorPx(20, 1000, 2, 720)).toBeCloseTo(14.4);
    expect(estimateFocusErrorPx(20, 2000, 2, 720)).toBeCloseTo(7.2);
    for (const args of [[NaN, 1, 1, 1], [-1, 1, 1, 1], [1, 0, 1, 1], [1, 1, 0, 1]]) expect(estimateFocusErrorPx(...args as [number, number, number, number])).toBeNull();
  });
  it("associates the hit mesh with its public load-model tile, ignoring cached coarse terrain", () => {
    const { tiles, camera } = scene();
    const probe = sampleTerrainFocus(tiles, camera, 100, 720);
    expect(probe).toMatchObject({ reason: "available", sampledAtMs: 100, geometricErrorM: 16, selectionTargetPx: 10 });
    expect(probe.distanceM).toBeCloseTo(995);
    expect(probe.estimatedScreenErrorPx).toBeGreaterThan(0);
  });
  it("distinguishes unloaded terrain, a ray missing terrain, and absent metadata", () => {
    const { tiles, camera, detail } = scene();
    expect(sampleTerrainFocus(undefined, camera, 100, 720).reason).toBe("no-visible-terrain");
    detail.geometricError = NaN;
    expect(sampleTerrainFocus(tiles, camera, 100, 720).reason).toBe("missing-geometric-error");
    camera.rotation.y = Math.PI; camera.updateMatrixWorld();
    expect(sampleTerrainFocus(tiles, camera, 100, 720).reason).toBe("no-center-ray-hit");
  });
});

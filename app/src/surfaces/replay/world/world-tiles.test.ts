import { describe, expect, it, vi } from "vitest";
import { TilesRenderer } from "3d-tiles-renderer/three";
import { TilesFadePlugin } from "3d-tiles-renderer/three/plugins";
import type { Tile } from "3d-tiles-renderer/core";
import { Group, Mesh, MeshBasicMaterial, PlaneGeometry, Raycaster, Vector3 } from "three";
import { WorldTilesRenderer } from "./world-tiles";

type Runtime = TilesRenderer & {
  setTileActive(tile: Tile, active: boolean): void;
  setTileVisible(tile: Tile, visible: boolean): void;
  invokeOnePlugin(callback: (plugin: {setTileVisible?: (tile: Tile, visible: boolean) => boolean}) => unknown): void;
};
function fixture(renderer: TilesRenderer) {
  const tiles = renderer as Runtime;
  const scene = new Group();
  const mesh = new Mesh(new PlaneGeometry(100, 100), new MeshBasicMaterial());
  scene.add(mesh);
  // A large Earth-to-local translation makes accidental detachment unambiguous.
  tiles.group.position.set(6_000_000, 0, 0); tiles.group.updateMatrixWorld(true);
  scene.position.x = -6_000_000;
  const tile = { engineData: {scene}, geometricError: 1, internal: {depthFromRenderedParent: 1}, traversal: {wasSetActive: true, wasInFrustum: true}, parent: null } as unknown as Tile;
  (tiles as unknown as {rootTileset: object}).rootTileset = {root: tile};
  tiles.setTileActive(tile, true); tiles.setTileVisible(tile, true);
  return { tiles, scene, mesh, tile, cleanup: () => {mesh.geometry.dispose(); mesh.material.dispose();} };
}

describe("local terrain coordinates through the pinned fade lifecycle", () => {
  it("keeps a fading-out inactive model on the actual local landscape", () => {
    const {tiles, scene, mesh, tile, cleanup} = fixture(new WorldTilesRenderer("https://example.test/root.json"));
    const fade = new TilesFadePlugin({fadeDuration: 200}); tiles.registerPlugin(fade);
    tiles.dispatchEvent({type:"load-model", scene, tile} as never);
    // The real pinned plugin retains the model, then traversal deactivates it.
    tiles.invokeOnePlugin(plugin => plugin.setTileVisible?.(tile, false));
    expect(tiles.group.children).toContain(scene);
    tiles.setTileActive(tile, false);
    tiles.group.updateMatrixWorld(true);
    expect(scene.parent).toBe(tiles.group);
    expect(mesh.getWorldPosition(new Vector3()).x).toBeCloseTo(0);
    expect(tiles.activeTiles.has(tile)).toBe(false);
    // Finishing the fade still disposes/detaches normally; no permanent retention.
    (fade as unknown as {dispose(): void}).dispose();
    expect(tiles.group.children).not.toContain(scene);
    expect(scene.parent).toBeNull(); cleanup();
  });
  it("detaches an inactive model when it is no longer a drawable child", () => {
    const {tiles, scene, tile, cleanup} = fixture(new WorldTilesRenderer("https://example.test/root.json"));
    tiles.setTileVisible(tile, false); tiles.setTileActive(tile, false);
    expect(scene.parent).toBeNull(); cleanup();
  });
  it("uses actual active geometry even when the provider's bounds miss it", () => {
    const {tiles, mesh, tile, cleanup} = fixture(new WorldTilesRenderer("https://example.test/root.json"));
    const ray = new Raycaster(new Vector3(0, 0, 10), new Vector3(0, 0, -1));
    ray.firstHitOnly = true;
    // The supported non-hierarchical path does not consult inaccurate tile bounds.
    const bounds = {intersectsRay: vi.fn(() => false)};
    Object.assign((tile as unknown as {engineData: object}).engineData, {boundingVolume: bounds});
    expect(ray.intersectObject(tiles.group, true)[0]?.object).toBe(mesh);
    expect(bounds.intersectsRay).not.toHaveBeenCalled(); cleanup();
  });
});

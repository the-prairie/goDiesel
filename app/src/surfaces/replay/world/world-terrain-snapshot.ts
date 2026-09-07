import { Box3, Frustum, Group, Material, Matrix4, Mesh, type Object3D, type PerspectiveCamera } from "three";
import type { Tile } from "3d-tiles-renderer/core";
import type { TilesRenderer } from "3d-tiles-renderer/three";

/** A finite, resident set of real terrain. Geometry/textures are shared, never copied or persisted. */
export class WorldTerrainSnapshot {
  readonly group = new Group();
  readonly tiles = new Set<Tile>();
  readonly sources = new Set<Object3D>();
  readonly meshes: Mesh[] = [];
  private readonly materials = new Map<Material, Material>();
  private compiling = 0;
  private disposed = false;
  bytes = 0;
  valid = true;

  static capture(renderer: TilesRenderer, camera: PerspectiveCamera, maximumBytes: number) {
    const result = new WorldTerrainSnapshot();
    const frustum = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    renderer.group.updateMatrixWorld(true);
    renderer.forEachLoadedModel((model, tile) => {
      if (!renderer.visibleTiles.has(tile) || !frustum.intersectsBox(new Box3().setFromObject(model))) return;
      const bytes = renderer.lruCache.getMemoryUsage(tile) ?? 0;
      // No partial lease masquerading as a complete one when the budget is exhausted.
      if (!Number.isFinite(bytes) || result.bytes + bytes > maximumBytes) { result.valid = false; return; }
      result.bytes += bytes;
      result.tiles.add(tile); result.sources.add(model);
      model.traverseVisible(object => {
        if (!(object instanceof Mesh)) return;
        // Photogrammetry GLBs are static meshes. Do not flatten skinned/instanced content.
        if ((object as Mesh & {isSkinnedMesh?: boolean;isInstancedMesh?: boolean}).isSkinnedMesh ||
            (object as Mesh & {isInstancedMesh?: boolean}).isInstancedMesh) { result.valid = false; return; }
        const cloneMaterial = (source: Material) => {
          let material = result.materials.get(source);
          if (!material) {
            material = source.clone();
            // The source fade plugin owns a mutable fade uniform. A leased model is
            // fully drawable even after that source fades/detaches. Use its original
            // GLTF material properties, not the plugin's fade callback/uniform state.
            const defines = (material as Material & {defines?: Record<string, unknown>}).defines;
            if (defines) delete defines.FEATURE_FADE;
            result.materials.set(source, material);
          }
          return material;
        };
        const mesh = new Mesh(object.geometry, Array.isArray(object.material) ? object.material.map(cloneMaterial) : cloneMaterial(object.material));
        mesh.matrixAutoUpdate = false; mesh.matrix.copy(object.matrixWorld);
        mesh.raycast = object.raycast;
        result.group.add(mesh); result.meshes.push(mesh);
      });
    });
    result.group.updateMatrixWorld(true);
    if (!result.valid || !result.meshes.length) { result.dispose(); return null; }
    result.retain(renderer);
    return result;
  }

  /** Mark the finite dependencies used each traversal; this does not grow the cache ceiling. */
  retain(renderer: TilesRenderer) { for (const tile of this.tiles) (renderer as TilesRenderer & {markTileUsed(tile: Tile): void}).markTileUsed(tile); }
  contains(model: Object3D) { return this.sources.has(model); }
  invalidate(model: Object3D) { if (this.contains(model)) this.valid = false; }
  /** compileAsync polls the material after returning. Keep its properties alive until that settles. */
  holdMaterials() {
    this.compiling++;
    let released=false;
    return () => { if(released)return;released=true;this.compiling--;if(this.disposed && this.compiling===0)this.disposeMaterials(); };
  }
  private disposeMaterials() { for(const material of this.materials.values())material.dispose();this.materials.clear(); }
  dispose() {
    this.disposed = true;
    this.valid = false;
    this.group.removeFromParent(); this.group.clear(); this.meshes.length = 0;
    if(this.compiling===0)this.disposeMaterials();
    this.sources.clear(); this.tiles.clear();
    // Shared source geometries and textures are disposed only by the tile cache.
  }
}

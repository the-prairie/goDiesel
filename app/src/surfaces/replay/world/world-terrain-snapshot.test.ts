import { describe, it, expect, vi } from "vitest";
import { Group, Mesh, MeshBasicMaterial, PlaneGeometry, PerspectiveCamera, Texture, Vector3 } from "three";
import { TilesRenderer } from "3d-tiles-renderer/three";
import type { Tile } from "3d-tiles-renderer/core";
import { WorldTerrainSnapshot } from "./world-terrain-snapshot";

function fixture() {
  const renderer=new TilesRenderer();
  renderer.group.position.x=6_000_000;renderer.group.updateMatrixWorld(true);
  const source=new Group();source.position.x=-6_000_000;
  const texture=new Texture(),material=new MeshBasicMaterial({map:texture});
  const mesh=new Mesh(new PlaneGeometry(100,100),material);source.add(mesh);renderer.group.add(source);
  const tile={engineData:{scene:source},geometricError:2} as unknown as Tile;
  renderer.visibleTiles.add(tile);renderer.lruCache.add(tile,()=>{});renderer.lruCache.setMemoryUsage(tile,1000);
  vi.spyOn(renderer,"forEachLoadedModel").mockImplementation(callback=>callback(source,tile));
  const camera=new PerspectiveCamera(50,1,.5,500);camera.position.z=50;camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
  return {renderer,source,mesh,tile,texture,material,camera,dispose(){mesh.geometry.dispose();texture.dispose();material.dispose();renderer.lruCache.remove(tile);}};
}
describe("finite terrain view residency",()=>{
  it("keeps real geometry in local coordinates after the original parent is detached",()=>{
    const f=fixture(),snapshot=WorldTerrainSnapshot.capture(f.renderer,f.camera,2000)!;
    expect(snapshot).not.toBeNull();expect(snapshot.meshes).toHaveLength(1);
    f.source.removeFromParent();f.source.updateMatrixWorld(true);
    expect(snapshot.meshes[0].getWorldPosition(new Vector3()).x).toBeCloseTo(0);
    expect(snapshot.meshes[0].geometry).toBe(f.mesh.geometry);
    expect((snapshot.meshes[0].material as MeshBasicMaterial).map).toBe(f.texture);
    snapshot.dispose();f.dispose();
  });
  it("freezes the dependency set while newer refinements arrive",()=>{
    const f=fixture(),snapshot=WorldTerrainSnapshot.capture(f.renderer,f.camera,2000)!;
    const later=new Group();f.renderer.group.add(later);
    expect(snapshot.sources.size).toBe(1);expect(snapshot.sources.has(later)).toBe(false);
    expect(snapshot.bytes).toBe(1000);snapshot.dispose();f.dispose();
  });
  it("keeps the retained material independent of mutable fade state",()=>{
    const f=fixture();f.material.defines={FEATURE_FADE:1};
    const snapshot=WorldTerrainSnapshot.capture(f.renderer,f.camera,2000)!;
    expect(snapshot.meshes[0].material).not.toBe(f.material);
    expect((snapshot.meshes[0].material as MeshBasicMaterial).defines?.FEATURE_FADE).toBeUndefined();
    expect(f.material.defines.FEATURE_FADE).toBe(1);snapshot.dispose();f.dispose();
  });
  it("refuses an over-budget partial snapshot and never disposes shared GPU resources",()=>{
    const f=fixture(),geometry=vi.spyOn(f.mesh.geometry,"dispose"),texture=vi.spyOn(f.texture,"dispose"),material=vi.spyOn(f.material,"dispose");
    expect(WorldTerrainSnapshot.capture(f.renderer,f.camera,500)).toBeNull();
    const snapshot=WorldTerrainSnapshot.capture(f.renderer,f.camera,2000)!;
    snapshot.dispose();snapshot.dispose();
    expect(geometry).not.toHaveBeenCalled();expect(texture).not.toHaveBeenCalled();expect(material).not.toHaveBeenCalled();f.dispose();
  });
  it("defers cloned-material disposal until in-flight compilation settles",()=>{
    const f=fixture(),snapshot=WorldTerrainSnapshot.capture(f.renderer,f.camera,2000)!;
    const material=vi.spyOn(snapshot.meshes[0].material as MeshBasicMaterial,"dispose");
    const finish=snapshot.holdMaterials();snapshot.dispose();expect(material).not.toHaveBeenCalled();
    finish();finish();expect(material).toHaveBeenCalledTimes(1);f.dispose();
  });
  it("invalidates a forced disposal rather than drawing released terrain",()=>{
    const f=fixture(),snapshot=WorldTerrainSnapshot.capture(f.renderer,f.camera,2000)!;
    snapshot.invalidate(new Group());expect(snapshot.valid).toBe(true);
    snapshot.invalidate(f.source);expect(snapshot.valid).toBe(false);snapshot.dispose();f.dispose();
  });
});

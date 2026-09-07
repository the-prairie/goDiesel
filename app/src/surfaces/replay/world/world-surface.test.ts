import { describe, expect, it, vi } from "vitest";
import { Group, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3 } from "three";
import { WorldSurfaceIndex } from "./world-surface";
function plane(height: number, x=0) {
  const scene=new Group(); scene.position.set(x,0,height);
  const mesh=new Mesh(new PlaneGeometry(100,100),new MeshBasicMaterial()); scene.add(mesh);
  return {scene,mesh,dispose:()=>{mesh.geometry.dispose();mesh.material.dispose();}};
}
const down=new Vector3(0,0,-1), above=new Vector3(0,0,1000);
describe("loaded terrain surface queries independent of visibility",()=>{
  it("uses detailed cached terrain rather than a higher coarse fallback",()=>{
    const coarse=plane(300),fine=plane(100); fine.scene.visible=false;
    const index=new WorldSurfaceIndex(new Matrix4()); index.add(coarse.scene,512);index.add(fine.scene,2);
    expect(index.cast(above,down)).toMatchObject({point:{z:100},geometricErrorM:2});
    expect(fine.scene.parent).toBeNull();expect(fine.scene.visible).toBe(false);
    coarse.dispose();fine.dispose();
  });
  it("prefers the finest hit even if a usable coarser surface is higher",()=>{
    const coarse=plane(120),fine=plane(100),roof=plane(105);
    const index=new WorldSurfaceIndex(new Matrix4());index.add(coarse.scene,8);index.add(fine.scene,1);index.add(roof.scene,1);
    expect(index.cast(above,down)?.point.z).toBeCloseTo(105);
    coarse.dispose();fine.dispose();roof.dispose();
  });
  it("does not ground the camera on coarse or unknown geometry",()=>{
    const item=plane(300);const index=new WorldSurfaceIndex(new Matrix4());index.add(item.scene,512);
    expect(index.cast(above,down)).toBeNull();index.add(item.scene,NaN);
    expect(index.cast(above,down)).toBeNull();item.dispose();
  });
  it("preserves Earth-to-local and nested transforms without parenting hidden scenes",()=>{
    const item=plane(25); item.scene.position.x=6_000_000;item.mesh.position.z=5;
    const matrix=new Matrix4().makeTranslation(-6_000_000,0,0);
    const index=new WorldSurfaceIndex(matrix);index.add(item.scene,1);
    expect(index.cast(above,down)?.point.z).toBeCloseTo(30);
    expect(item.scene.parent).toBeNull();expect(item.scene.position.x).toBe(6_000_000);
    // A cached model's renderer matrix can be stale or detached; query coordinates aren't.
    item.scene.matrixWorld.makeTranslation(0,0,900);
    expect(index.cast(above,down)?.point.z).toBeCloseTo(30);item.dispose();
  });
  it("uses real mesh bounds to avoid unrelated meshes and not provider bounds",()=>{
    const local=plane(100),remote=plane(100,10000);
    const raycast=vi.spyOn(remote.mesh,"raycast");
    const index=new WorldSurfaceIndex(new Matrix4());index.add(local.scene,1);index.add(remote.scene,1);
    expect(index.cast(above,down)?.point.z).toBe(100);expect(raycast).not.toHaveBeenCalled();
    local.dispose();remote.dispose();
  });
  it("releases query references on tile disposal without owning shared GPU resources",()=>{
    const item=plane(100);const disposing=vi.spyOn(item.mesh.geometry,"dispose");
    const index=new WorldSurfaceIndex(new Matrix4());index.add(item.scene,1);index.remove(item.scene);
    expect(index.size).toBe(0);expect(index.cast(above,down)).toBeNull();expect(disposing).not.toHaveBeenCalled();
    index.add(item.scene,1);index.clear();expect(index.size).toBe(0);expect(disposing).not.toHaveBeenCalled();item.dispose();
  });
  it("rejects non-finite rays and invalid error limits",()=>{
    const index=new WorldSurfaceIndex(new Matrix4());
    expect(index.cast(above,new Vector3())).toBeNull();expect(index.cast(above,down,NaN)).toBeNull();
    expect(index.cast(new Vector3(NaN,0,0),down)).toBeNull();
  });
});

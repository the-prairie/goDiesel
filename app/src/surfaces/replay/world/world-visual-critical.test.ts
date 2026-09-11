import { describe, expect, it } from "vitest";
import { Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry } from "three";
import { collectWorldVisualCriticalMeshes } from "./world-visual-critical";

describe("visual-critical terrain set",()=>{
  it("keeps the visible ground winner and ignores occluded/offscreen meshes",()=>{
    const camera=new PerspectiveCamera(50,1.5,.1,1000);camera.position.set(0,0,10);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
    const front=new Mesh(new PlaneGeometry(20,20),new MeshBasicMaterial());front.updateMatrixWorld(true);
    const behind=new Mesh(new PlaneGeometry(20,20),new MeshBasicMaterial());behind.position.z=-5;behind.updateMatrixWorld(true);
    const offscreen=new Mesh(new PlaneGeometry(2,2),new MeshBasicMaterial());offscreen.position.x=100;offscreen.updateMatrixWorld(true);
    const result=collectWorldVisualCriticalMeshes([front,behind,offscreen],camera);
    expect(result.tested).toBeGreaterThan(0);expect(result.hits).toBeGreaterThan(0);
    expect(result.meshes).toContain(front);expect(result.meshes).not.toContain(behind);expect(result.meshes).not.toContain(offscreen);
    for(const mesh of [front,behind,offscreen]){mesh.geometry.dispose();(mesh.material as MeshBasicMaterial).dispose();}
  });
  it("is bounded even when every probe resolves to a different mesh",()=>{
    const camera=new PerspectiveCamera();camera.updateMatrixWorld(true);
    expect(collectWorldVisualCriticalMeshes([],camera,3).meshes).toHaveLength(0);
  });
});

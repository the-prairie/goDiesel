import { describe, expect, it } from "vitest";
import { AlwaysStencilFunc, Group, KeepStencilOp, Mesh, MeshBasicMaterial, NotEqualStencilFunc, PlaneGeometry, ReplaceStencilOp } from "three";
import { withWorldTerrainFallback } from "./world-terrain-composite";

describe("resident terrain fills holes without hiding replacements", () => {
  it("gives live pixels precedence even when the retained geometry is nearer", () => {
    const live=new Group(),nested=new Group(),retained=new Group(),geometry=new PlaneGeometry();
    const fine=new MeshBasicMaterial(),coarse=fine.clone();
    nested.add(new Mesh(geometry,fine));live.add(nested);retained.add(new Mesh(geometry,coarse));
    const result=withWorldTerrainFallback(live,retained,()=>{
      expect(fine.stencilFunc).toBe(AlwaysStencilFunc);expect(fine.stencilZPass).toBe(ReplaceStencilOp);
      expect(coarse.stencilFunc).toBe(NotEqualStencilFunc);expect(coarse.stencilWriteMask).toBe(1);
      expect(coarse.stencilFail).toBe(KeepStencilOp);expect(coarse.stencilZFail).toBe(KeepStencilOp);expect(coarse.stencilZPass).toBe(KeepStencilOp);
      expect(nested.renderOrder).toBeLessThan(retained.renderOrder);expect(live.visible).toBe(true);
      return 123;
    });
    expect(result).toBe(123);expect(fine.stencilWrite).toBe(false);expect(coarse.stencilWrite).toBe(false);
    expect(nested.renderOrder).toBe(0);expect(retained.renderOrder).toBe(0);
    geometry.dispose();fine.dispose();coarse.dispose();
  });
  it("restores preexisting stencil state and ordering even when a render fails", () => {
    const live=new Group(),retained=new Group(),geometry=new PlaneGeometry(),material=new MeshBasicMaterial();
    material.stencilRef=17;material.stencilWriteMask=0x40;live.renderOrder=7;
    live.add(new Mesh(geometry,material));
    expect(()=>withWorldTerrainFallback(live,retained,()=>{throw Error("GPU failure");})).toThrow("GPU failure");
    expect(material.stencilRef).toBe(17);expect(material.stencilWriteMask).toBe(0x40);expect(live.renderOrder).toBe(7);
    geometry.dispose();material.dispose();
  });
});

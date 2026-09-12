import {
  AlwaysStencilFunc, Group, KeepStencilOp, Material, Mesh,
  NotEqualStencilFunc, ReplaceStencilOp, type Object3D,
} from "three";

const TERRAIN_BIT = 0x01;
const LIVE_ORDER = -10000;
const RETAINED_ORDER = -9999;
const stencilKeys = ["stencilWrite", "stencilWriteMask", "stencilFunc", "stencilRef",
  "stencilFuncMask", "stencilFail", "stencilZFail", "stencilZPass"] as const;

/**
 * Live terrain owns every pixel it draws. A resident snapshot fills only the
 * remaining pixels, even when its older surface is nearer than the replacement.
 * A normal depth overlay cannot guarantee that: stale/coarse hills can occlude
 * their own refinement. Both buffers are cleared by the owning render pass.
 *
 * Requires stencil-enabled render targets (including atmosphere and probes).
 * The scope is synchronous: no callbacks, material clones or provider resources
 * survive it. Source material state and scene ordering are restored on failure.
 */
export function withWorldTerrainFallback<T>(live: Object3D, retained: Group, draw: () => T): T {
  const materials = new Map<Material, Pick<Material, typeof stencilKeys[number]>>();
  const orders = new Map<Group, number>();
  const configure = (root: Object3D, fallback: boolean) => {
    root.traverseVisible(object => {
      if (object instanceof Group) {
        orders.set(object, object.renderOrder);
        object.renderOrder = fallback ? RETAINED_ORDER : LIVE_ORDER;
      }
      if (!(object instanceof Mesh)) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (materials.has(material)) continue;
        const previous = Object.fromEntries(stencilKeys.map(key => [key, material[key]])) as Pick<Material, typeof stencilKeys[number]>;
        materials.set(material, previous);
        material.stencilWrite = true;
        material.stencilWriteMask = fallback ? 0 : TERRAIN_BIT;
        material.stencilFuncMask = TERRAIN_BIT;
        material.stencilRef = TERRAIN_BIT;
        material.stencilFunc = fallback ? NotEqualStencilFunc : AlwaysStencilFunc;
        material.stencilFail = material.stencilZFail = KeepStencilOp;
        material.stencilZPass = fallback ? KeepStencilOp : ReplaceStencilOp;
      }
    });
  };
  try {
    configure(live, false);
    configure(retained, true);
    return draw();
  } finally {
    for (const [material, previous] of materials) Object.assign(material, previous);
    for (const [group, order] of orders) group.renderOrder = order;
  }
}

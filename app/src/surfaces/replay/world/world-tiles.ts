import { TilesRenderer } from "3d-tiles-renderer/three";
import type { Tile } from "3d-tiles-renderer/core";
import type { Object3D } from "three";

type EngineTile = Tile & { engineData: { scene?: Object3D } };
// 0.5.2 implements this lifecycle method but omits it from its declaration file.
const lifecycle = TilesRenderer.prototype as unknown as {
  setTileActive(this: TilesRenderer, tile: Tile, active: boolean): void;
};

/** Keep the ENU transform attached until the fade plugin actually removes a tile. */
export class WorldTilesRenderer extends TilesRenderer {
  constructor(url: string) {
    super(url);
    // Google photogrammetry bounds can exclude parts of the actual mesh. Clearance
    // must test active geometry rather than treat a hierarchy miss as empty air.
    this.accelerateRaycast = false;
  }
  setTileActive(tile: Tile, active: boolean) {
    lifecycle.setTileActive.call(this, tile, active);
    const scene = (tile as EngineTile).engineData.scene;
    // Fade-out tiles are still drawable children after becoming inactive. The
    // pinned base implementation clears their parent before fading completes,
    // losing the Earth-to-local matrix and throwing geometry outside the scene.
    if (!active && scene && this.group.children.includes(scene)) {
      scene.parent = this.group;
      scene.updateMatrixWorld(true);
    }
  }
}

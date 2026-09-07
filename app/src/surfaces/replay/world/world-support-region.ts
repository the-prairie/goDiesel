import { OBBRegion } from "3d-tiles-renderer/three/plugins";
import { Matrix4, Vector3 } from "three";
import { WorldFrame } from "./world-frame";

/** A narrow, finite vertical loading column, not an invented ground surface. */
export class WorldSupportRegion extends OBBRegion {
  private readonly center = new Vector3();
  constructor(errorTarget = 2) { super({errorTarget}); }
  locate(frame: WorldFrame, position: Vector3, radius: number, verticalHalfExtent = 1500) {
    this.center.copy(position).applyMatrix4(frame.worldToECEF);
    this.obb.box.min.set(-radius, -radius, -verticalHalfExtent);
    this.obb.box.max.set(radius, radius, verticalHalfExtent);
    this.obb.transform.copy(frame.worldToECEF).multiply(new Matrix4().makeTranslation(position.x, position.y, position.z));
    this.obb.update();
  }
  override calculateDistance(volume: { distanceToPoint(point: Vector3): number }) { return volume.distanceToPoint(this.center); }
}

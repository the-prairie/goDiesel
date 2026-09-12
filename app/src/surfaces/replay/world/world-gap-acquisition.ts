import { Vector3, type PerspectiveCamera } from "three";
import type { WorldRasterCoverage } from "./world-raster-coverage";

/**
 * Convert missing screen regions to bounded loading interests. Intersecting the
 * subject-height plane is ONLY a request hint: it never supplies a ground sample,
 * camera height, route altitude or readiness result. Tall vertical OBBs tolerate
 * relief; the actual arriving provider geometry must pass the same visual gate.
 */
export function planWorldGapAcquisition(mask: WorldRasterCoverage, camera: PerspectiveCamera,
  subject: Vector3, viewportHeight: number, targetPixels: number) {
  const up=camera.up.clone().normalize();
  const height=subject.clone().sub(camera.position).dot(up);
  return mask.missingGroundSamples.flatMap(sample=>{
    const direction=new Vector3(sample.xNdc,sample.yNdc,.5).unproject(camera).sub(camera.position).normalize();
    const vertical=direction.dot(up);
    if(vertical>=-.02)return [];
    const distance=height/vertical;
    if(!Number.isFinite(distance)||distance<=camera.near||distance>Math.min(camera.far,8000))return [];
    const metresPerPixel=2*distance*Math.tan(camera.fov*Math.PI/360)/Math.max(1,viewportHeight);
    return [{position:camera.position.clone().addScaledVector(direction,distance),
      radiusM:Math.min(220,Math.max(24,metresPerPixel*viewportHeight/10)),
      errorTargetM:Math.min(64,Math.max(2,metresPerPixel*targetPixels))}];
  }).slice(0,4);
}

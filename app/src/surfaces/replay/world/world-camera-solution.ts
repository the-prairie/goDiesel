import { PerspectiveCamera, Vector3 } from "three";
import type { GoogleRouteCameraPose } from "../playback/route-navigator-controller";
import { WorldFrame } from "./world-frame";
import { WorldSurfaceIndex } from "./world-surface";
export interface WorldCameraSolution {
  target: Vector3;
  targetErrorM: number | null;
  targetCorrectionM: number;
  groundHeightM: number | null;
  heightM: number;
  clearanceM: number | null;
  liftM: number;
  sightline: "clear" | "blocked" | "unknown";
}
/** A display-only camera solution. Recorded route coordinates and elevations never change. */
export function solveWorldCamera(frame: WorldFrame, surfaces: WorldSurfaceIndex, pose: GoogleRouteCameraPose,
  camera: PerspectiveCamera, recorded: boolean): WorldCameraSolution {
  const seed = pose.center.altitude ?? 0, up = frame.normal(pose.center.lat, pose.center.lng);
  const hit = surfaces.cast(frame.position(pose.center.lat, pose.center.lng, Math.max(10000, seed + 2000)), up.clone().negate());
  const surfaceHeight = hit ? frame.height(hit.point) : null;
  const correction = recorded && surfaceHeight !== null ? Math.max(-120, Math.min(120, surfaceHeight - seed)) : 0;
  const targetHeight = recorded ? seed + correction : surfaceHeight ?? seed;
  const target = frame.camera(camera, pose, targetHeight);
  const initialPosition = camera.position.clone();
  const ground = surfaces.cast(camera.position.clone().addScaledVector(up, 2000), up.clone().negate());
  const baseClearance = ground ? camera.position.clone().sub(ground.point).dot(up) : null;
  if (baseClearance !== null && baseClearance < 18) camera.position.addScaledVector(up, 18 - baseClearance);
  // Clearance beneath the lens does not prove visibility of the route. Test the
  // camera-to-subject segment, including intermediate heights before adopting it.
  let sightline: WorldCameraSolution["sightline"] = "unknown";
  if (hit) {
    const subject = target.clone().addScaledVector(up, 2);
    const error = Math.max(2.1, Math.min(8, hit.geometricErrorM + 0.05));
    for (let step = 0; step < 9; step++) {
      if (surfaces.obstruction(camera.position, subject, error, 5) === null) { sightline = "clear"; break; }
      sightline = "blocked";
      if (step < 8) camera.position.addScaledVector(up, 30);
    }
  }
  camera.lookAt(target); camera.updateMatrixWorld(true);
  const liftM = camera.position.clone().sub(initialPosition).dot(up);
  return { target, targetErrorM: hit?.geometricErrorM ?? null, targetCorrectionM: correction,
    groundHeightM: ground ? frame.height(ground.point) : null, heightM: frame.height(camera.position),
    clearanceM: baseClearance === null ? null : baseClearance + liftM, liftM, sightline };
}

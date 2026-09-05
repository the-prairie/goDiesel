import { Matrix4, PerspectiveCamera, Vector3 } from "three";
import { Ellipsoid, Geodetic } from "@takram/three-geospatial";
import type { GoogleRouteCameraPose } from "@/surfaces/replay/playback/route-navigator-controller";
const radians = (degrees: number) => degrees * Math.PI / 180;

/** Local ENU coordinates keep float32 geometry near the origin, even at the date line. */
export class WorldFrame {
  readonly worldToECEF: Matrix4;
  readonly ecefToWorld: Matrix4;
  constructor(lat: number, lng: number) {
    const origin = new Geodetic(radians(lng), radians(lat), 0).toECEF();
    this.worldToECEF = Ellipsoid.WGS84.getEastNorthUpFrame(origin);
    this.ecefToWorld = this.worldToECEF.clone().invert();
  }
  position(lat: number, lng: number, height: number) {
    return new Geodetic(radians(lng), radians(lat), height).toECEF().applyMatrix4(this.ecefToWorld);
  }
  normal(lat: number, lng: number) {
    const ecef = new Geodetic(radians(lng), radians(lat), 0).toECEF();
    return Ellipsoid.WGS84.getSurfaceNormal(ecef).transformDirection(this.ecefToWorld);
  }
  height(position: Vector3) {
    return new Geodetic().setFromECEF(position.clone().applyMatrix4(this.worldToECEF)).height;
  }
  camera(camera: PerspectiveCamera, pose: GoogleRouteCameraPose, targetHeight: number) {
    const target = this.position(pose.center.lat, pose.center.lng, targetHeight);
    const ecef = target.clone().applyMatrix4(this.worldToECEF);
    const east = new Vector3(), north = new Vector3(), up = new Vector3();
    Ellipsoid.WGS84.getEastNorthUpVectors(ecef, east, north, up);
    for (const vector of [east, north, up]) vector.transformDirection(this.ecefToWorld);
    const heading = radians(pose.headingDeg), tilt = radians(Math.min(78, pose.tiltDeg));
    camera.position.copy(target)
      .addScaledVector(up, pose.rangeM * Math.cos(tilt))
      .addScaledVector(north, -pose.rangeM * Math.sin(tilt) * Math.cos(heading))
      .addScaledVector(east, -pose.rangeM * Math.sin(tilt) * Math.sin(heading));
    camera.up.copy(up);
    camera.lookAt(target);
    camera.fov = pose.fovDeg;
    camera.near = Math.max(0.5, pose.rangeM / 100);
    camera.far = Math.max(100_000, pose.rangeM * 8);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    return target;
  }
}

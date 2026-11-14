// The jump's camera, matched at the cut: the dive ends with MapLibre's
// camera standing exactly where the 3D replay's opening camera will stand
// (same centre, heading, tilt and field of view, at its range), so when the
// drawn city gives way to Google's the view does not jump.

import { MAPLIBRE_FOV_DEG } from "@/labs/sketch/sketch-camera-match";

export interface ReplayPose {
  center: { lat: number; lng: number };
  headingDeg: number;
  tiltDeg: number;
  rangeM: number;
  /** Google's 3D map's field of view, taken as vertical, like MapLibre's. */
  fovDeg: number;
}

const EARTH_CIRCUMFERENCE_M = 40075016.686;
const MAX_PITCH = 80;

export function mapCameraForReplay(pose: ReplayPose, { height }: { height: number }) {
  const rad = Math.PI / 180;
  const distancePx = height / 2 / Math.tan((pose.fovDeg * rad) / 2);
  const metresPerPixel = pose.rangeM / distancePx;
  const zoom = Math.log2((EARTH_CIRCUMFERENCE_M * Math.cos(pose.center.lat * rad)) / (512 * metresPerPixel));
  return {
    center: [pose.center.lng, pose.center.lat] as [number, number],
    zoom,
    pitch: Math.min(MAX_PITCH, pose.tiltDeg),
    bearing: pose.headingDeg,
    fovDeg: pose.fovDeg,
  };
}

/** The field of view part-way through a flight, from MapLibre's own to `toFov`, by how far the zoom has come. */
export function fovAlongFlight({ fromZoom, toZoom, zoom, toFov, fromFov = MAPLIBRE_FOV_DEG }: { fromZoom: number; toZoom: number; zoom: number; toFov: number; fromFov?: number }) {
  if (toZoom === fromZoom) return toFov;
  const t = Math.min(1, Math.max(0, (zoom - fromZoom) / (toZoom - fromZoom)));
  return fromFov + (toFov - fromFov) * t;
}

// The real-geometry sketch's Cesium camera, matched to MapLibre's view so
// the fade between them does not jump. MapLibre stands its camera
// `cameraToCenterDistance` pixels from the centre, tilted by `pitch` and
// turned by `bearing`; a pixel is a known number of metres at a zoom and
// latitude, so the same camera can be placed in metres over Google's city.

/** MapLibre's vertical field of view, in degrees. */
export const MAPLIBRE_FOV_DEG = 36.86989764584402;

const EARTH_CIRCUMFERENCE_M = 40075016.686;
const EARTH_RADIUS_M = 6378137;

export interface MapLibreView {
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
  width: number;
  height: number;
  /** The street's height above the ellipsoid here (see photoreal-coverage). */
  groundEllipsoidM: number;
}

export interface CesiumCameraPose {
  lng: number;
  lat: number;
  heightM: number;
  headingDeg: number;
  pitchDeg: number;
  /** Cesium's field of view: the wider of the two dimensions. */
  fovDeg: number;
}

export function matchCamera({ center, zoom, pitch, bearing, width, height, groundEllipsoidM }: MapLibreView): CesiumCameraPose {
  const rad = Math.PI / 180;
  const halfFov = (MAPLIBRE_FOV_DEG * rad) / 2;
  const distancePx = height / 2 / Math.tan(halfFov);
  const metresPerPixel = (EARTH_CIRCUMFERENCE_M * Math.cos(center[1] * rad)) / (512 * 2 ** zoom);
  const distanceM = distancePx * metresPerPixel;
  const back = distanceM * Math.sin(pitch * rad);
  const up = distanceM * Math.cos(pitch * rad);
  // Step back against the bearing, on the ground.
  const dNorth = -back * Math.cos(bearing * rad);
  const dEast = -back * Math.sin(bearing * rad);
  const lat = center[1] + (dNorth / EARTH_RADIUS_M) / rad;
  const lng = center[0] + (dEast / (EARTH_RADIUS_M * Math.cos(center[1] * rad))) / rad;
  const fovDeg = width > height ? (2 * Math.atan(Math.tan(halfFov) * (width / height))) / rad : MAPLIBRE_FOV_DEG;
  return { lng, lat, heightM: groundEllipsoidM + up, headingDeg: bearing, pitchDeg: pitch - 90, fovDeg };
}

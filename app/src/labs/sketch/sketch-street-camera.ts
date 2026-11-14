import { MAPLIBRE_FOV_DEG } from "@/labs/sketch/sketch-camera-match";
import { streetView, type SketchCamera } from "@/labs/sketch/sketch-camera";
import { metresBetween, type LngLat } from "@/labs/sketch/sketch-reveal";

// The Street view: the view it always had (low at the route's start, looking
// along it) wherever that is open; where a building would stand in her face,
// further along the first stretch or higher. Pure: the drawn buildings' heights come in as
// `heightAt` (metres, 0 for open ground).

type HeightAt = (lng: number, lat: number) => number;

const M_LAT = 110540;
const mLng = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180);

/** Where MapLibre's eye stands for a camera: behind the centre along the bearing, high by the pitch. */
export function eyeOf(camera: Pick<SketchCamera, "center" | "zoom" | "pitch" | "bearing">, viewport: { height: number }) {
  const [lng, lat] = camera.center;
  const metresPerPixel = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** camera.zoom);
  const distance = ((0.5 * viewport.height) / Math.tan((MAPLIBRE_FOV_DEG * Math.PI) / 360)) * metresPerPixel;
  const pitch = (camera.pitch * Math.PI) / 180;
  const back = distance * Math.sin(pitch);
  const bearing = (camera.bearing * Math.PI) / 180;
  return { lng: lng - (Math.sin(bearing) * back) / mLng(lat), lat: lat - (Math.cos(bearing) * back) / M_LAT, heightM: distance * Math.cos(pitch), backM: back };
}

/** The point some metres along the line, and the bearing the route sets off on from it. */
function along(line: readonly LngLat[], metres: number): { at: LngLat; bearing: number } {
  let travelled = 0;
  let at: LngLat = line[0];
  let i = 1;
  for (; i < line.length; i += 1) {
    const step = metresBetween(line[i - 1], line[i]);
    if (travelled + step >= metres) {
      const t = step > 0 ? (metres - travelled) / step : 0;
      at = [line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t];
      break;
    }
    travelled += step;
    at = line[i];
  }
  // Look 60 m on.
  let ahead = at;
  let more = 0;
  for (let j = Math.min(i, line.length - 1); j < line.length; j += 1) {
    more += metresBetween(j === i ? at : line[j - 1], line[j]);
    ahead = line[j];
    if (more >= 60) break;
  }
  const dx = (ahead[0] - at[0]) * mLng(at[1]);
  const dy = (ahead[1] - at[1]) * M_LAT;
  return { at, bearing: dx === 0 && dy === 0 ? 0 : ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360 };
}

/**
 * How blocked the view is. The middle line of sight must reach the ground she
 * looks at (a building on it is the wall in her face: counts 2). The side
 * lines only look for a building close beside her eye, in the near half: in
 * an ordinary street they meet the buildings that line it further on, which
 * is what a street looks like.
 */
function blocked(camera: SketchCamera, heightAt: HeightAt, viewport: { height: number }) {
  const eye = eyeOf(camera, viewport);
  if (heightAt(eye.lng, eye.lat) >= eye.heightM) return 99;
  let score = 0;
  for (const turn of [-20, -10, 0, 10, 20]) {
    const angle = ((camera.bearing + turn) * Math.PI) / 180;
    const reach = eye.backM * (turn === 0 ? 0.97 : 0.5);
    for (let s = 4; s < reach; s += 4) {
      const lng = eye.lng + (Math.sin(angle) * s) / mLng(eye.lat);
      const lat = eye.lat + (Math.cos(angle) * s) / M_LAT;
      if (heightAt(lng, lat) > eye.heightM * (1 - s / eye.backM)) {
        score += turn === 0 ? 2 : 1;
        break;
      }
    }
  }
  return score;
}

const VIEWS = [
  { zoom: 18.2, pitch: 74 },
  { zoom: 17.9, pitch: 68 },
  { zoom: 17.5, pitch: 60 },
  { zoom: 17.1, pitch: 52 },
];

export function streetCamera(line: readonly LngLat[], heightAt: HeightAt, viewport: { height: number }): SketchCamera {
  const order: [number, number][] = [];
  for (const [views, distances] of [[[0, 1, 2], [40, 90]], [[0, 1, 2], [160]], [[3], [40, 90, 160]], [[0, 1, 2, 3], [250]]] as const)
    for (const view of views) for (const metres of distances) order.push([view, metres]);
  const cameras: SketchCamera[] = [
    streetView(line),
    ...order.map(([view, metres]) => {
      const { at, bearing } = along(line, metres);
      return { center: at, bearing, ...VIEWS[view] } satisfies SketchCamera;
    }),
  ];
  // The first she can see along: the middle line clear, at most one side line blocked.
  const clear = cameras.find((camera) => blocked(camera, heightAt, viewport) <= 1);
  if (clear) return clear;
  // Walls everywhere: the highest eye, to see over them.
  return cameras.reduce((best, camera) => (eyeOf(camera, viewport).heightM > eyeOf(best, viewport).heightM ? camera : best));
}

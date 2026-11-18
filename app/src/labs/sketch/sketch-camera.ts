// Where the sketch camera goes: far out over the country, over her routes in
// the city, down at a route's start for the jump, and low in the street.

import { metresBetween, type LngLat } from "@/labs/sketch/sketch-reveal";

export interface SketchCamera {
  center: LngLat;
  zoom: number;
  pitch: number;
  bearing: number;
}

export interface Box {
  west: number;
  east: number;
  south: number;
  north: number;
}

/** Japan, whole, from above. */
export function farView(): SketchCamera {
  return { center: [137.5, 36.4], zoom: 4.4, pitch: 0, bearing: 0 };
}

const mercatorY = (lat: number) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};

/** The zoom at which a box fills a screen (512 px tiles), less a padding in px. */
export function fitZoom(box: Box, screen: { width: number; height: number }, padding: number) {
  const dx = Math.max(1e-9, (box.east - box.west) / 360);
  const dy = Math.max(1e-9, mercatorY(box.south) - mercatorY(box.north));
  const width = Math.max(1, screen.width - padding * 2);
  const height = Math.max(1, screen.height - padding * 2);
  return Math.log2(Math.min(width / (512 * dx), height / (512 * dy)));
}

function boundsOf(lines: readonly (readonly LngLat[])[]): Box {
  const points = lines.flat();
  return {
    west: Math.min(...points.map((point) => point[0])),
    east: Math.max(...points.map((point) => point[0])),
    south: Math.min(...points.map((point) => point[1])),
    north: Math.max(...points.map((point) => point[1])),
  };
}

/** Over her routes in a city, tilted, all of them in view. */
export function cityView(lines: readonly (readonly LngLat[])[], screen: { width: number; height: number }): SketchCamera {
  const box = boundsOf(lines);
  // Tilted, the far half of the view shrinks: give the box a little room.
  const zoom = fitZoom(box, screen, Math.min(screen.width, screen.height) * 0.12) - 0.35;
  return { center: [(box.west + box.east) / 2, (box.south + box.north) / 2], zoom: Math.min(16, zoom), pitch: 50, bearing: -12 };
}

/**
 * Straight down over a country's routes, or all of them: north up, none closer
 * than a city, fitted into the band between the buttons above, the list
 * below and the keys down the right. A tall phone cannot zoom out past the
 * world filling its height, so when her routes are wider than that shows, it
 * shows the stretch of the world with most of them (the rest is a swipe away,
 * and in the list).
 */
export function regionView(lines: readonly (readonly LngLat[])[], screen: { width: number; height: number }, insets: { top: number; bottom: number; right?: number } = { top: 0, bottom: 0 }): SketchCamera {
  const box = boundsOf(lines);
  const right = insets.right ?? 0;
  const band = { width: Math.max(1, screen.width - right), height: Math.max(1, screen.height - insets.top - insets.bottom) };
  const floor = Math.log2(screen.height / 512);
  let zoom = Math.max(floor, Math.min(11, fitZoom(box, band, Math.min(screen.width, band.height) * 0.1)));
  let lng = (box.west + box.east) / 2;
  const span = (band.width / (512 * 2 ** zoom)) * 360;
  if (box.east - box.west > span) {
    zoom = floor;
    const starts = lines.map((line) => line[0][0]).sort((a, b) => a - b);
    let best = { count: -1, from: starts[0] };
    for (const from of starts) {
      const count = starts.filter((x) => x >= from && x <= from + span * 0.9).length;
      if (count > best.count) best = { count, from };
    }
    const inside = starts.filter((x) => x >= best.from && x <= best.from + span * 0.9);
    lng = (inside[0] + inside[inside.length - 1]) / 2;
  }
  // The box's middle, moved so it sits in the middle of the free band.
  const world = 512 * 2 ** zoom;
  lng += (right / 2 / world) * 360;
  const y = (mercatorY(box.south) + mercatorY(box.north)) / 2 + (insets.bottom - insets.top) / 2 / world;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
  return { center: [lng, lat], zoom, pitch: 0, bearing: 0 };
}

/** The compass bearing from a to b, in degrees clockwise from north. */
function bearingOf(a: LngLat, b: LngLat) {
  const y = Math.sin(((b[0] - a[0]) * Math.PI) / 180) * Math.cos((b[1] * Math.PI) / 180);
  const x =
    Math.cos((a[1] * Math.PI) / 180) * Math.sin((b[1] * Math.PI) / 180) -
    Math.sin((a[1] * Math.PI) / 180) * Math.cos((b[1] * Math.PI) / 180) * Math.cos(((b[0] - a[0]) * Math.PI) / 180);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** The point some way along the line, for which way the route sets off. */
function aheadOf(line: readonly LngLat[], metres: number): LngLat | undefined {
  let travelled = 0;
  for (let i = 1; i < line.length; i += 1) {
    travelled += metresBetween(line[i - 1], line[i]);
    if (travelled >= metres) return line[i];
  }
  return line.length > 1 && metresBetween(line[0], line[line.length - 1]) > 0 ? line[line.length - 1] : undefined;
}

/** Close at the route's start, tilted, looking along its first few hundred metres. */
export function routeStartView(line: readonly LngLat[]): SketchCamera {
  const ahead = aheadOf(line, 300);
  return { center: line[0], zoom: 17.2, pitch: 60, bearing: ahead ? bearingOf(line[0], ahead) : 0 };
}

/** Low and steep, the street's own height. */
export function streetView(line: readonly LngLat[]): SketchCamera {
  return { ...routeStartView(line), zoom: 18.2, pitch: 78 };
}

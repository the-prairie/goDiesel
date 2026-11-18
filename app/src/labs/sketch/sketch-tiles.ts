// Which building tiles the edge layer draws. A low, tilted camera looks far
// past its nearest buildings, the ones that must carry ink: they stand at
// the foot of the screen. So tiles are taken along the line from the ground
// at the foot of the screen to the middle of the view, nearest first.

export interface TilePoint {
  /** Fractional tile coordinates at the building tiles' zoom: the ground nearest the viewer. */
  camera: [number, number];
  center: [number, number];
  maxTiles: number;
}

export function tilesToDraw({ camera, center, maxTiles }: TilePoint): { x: number; y: number }[] {
  const seen = new Map<string, { x: number; y: number; d: number }>();
  const length = Math.hypot(center[0] - camera[0], center[1] - camera[1]);
  const steps = Math.max(1, Math.ceil(length / 0.5));
  const ux = length > 0 ? (center[0] - camera[0]) / length : 0;
  const uy = length > 0 ? (center[1] - camera[1]) / length : 0;
  /** Nearer the camera along the view first; off to the side or behind costs more. */
  const score = (cx: number, cy: number) => {
    const rx = cx - camera[0];
    const ry = cy - camera[1];
    if (length === 0) return Math.hypot(rx, ry);
    const along = rx * ux + ry * uy;
    const off = Math.abs(rx * uy - ry * ux);
    return Math.max(0, along) * 0.6 + Math.max(0, -along) * 3 + off * 1.5;
  };
  for (let s = 0; s <= steps; s += 1) {
    const t = s / steps;
    const px = camera[0] + (center[0] - camera[0]) * t;
    const py = camera[1] + (center[1] - camera[1]) * t;
    for (let dy = -1; dy <= 1; dy += 1)
      for (let dx = -1; dx <= 1; dx += 1) {
        const x = Math.floor(px) + dx;
        const y = Math.floor(py) + dy;
        const key = `${x}/${y}`;
        const d = score(x + 0.5, y + 0.5);
        const known = seen.get(key);
        if (!known || d < known.d) seen.set(key, { x, y, d });
      }
  }
  return [...seen.values()]
    .sort((a, b) => a.d - b.d || a.x - b.x || a.y - b.y)
    .slice(0, maxTiles)
    .map(({ x, y }) => ({ x, y }));
}

/** A camera as MapLibre holds it, with the screen height in CSS pixels. */
export interface ViewCamera {
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
  fovDeg: number;
  height: number;
}

/** A place in fractional tile coordinates at zoom z (Web Mercator). */
export const toTile = (lng: number, lat: number, z: number): [number, number] => {
  const n = 2 ** z;
  const s = Math.sin((lat * Math.PI) / 180);
  return [((lng + 180) / 360) * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
};

/**
 * The ground at the foot of the screen for a camera that is not there yet, in
 * fractional tile coordinates at `tileZoom`: what the edge layer measures by
 * unprojecting once the camera has arrived. MapLibre stands the camera
 * 0.5·height / tan(fov/2) pixels from the middle of the view; the screen's
 * bottom ray leaves it at (pitch − fov/2) from the vertical.
 */
export function groundAtFoot(camera: Omit<ViewCamera, "fovDeg" | "height"> & { fovDeg: number; height: number }, tileZoom: number): [number, number] {
  const half = (camera.fovDeg * Math.PI) / 360;
  const pitch = (camera.pitch * Math.PI) / 180;
  const distance = (0.5 * camera.height) / Math.tan(half);
  const offsetPx = distance * Math.sin(pitch) - distance * Math.cos(pitch) * Math.tan(pitch - half);
  const offsetTiles = offsetPx / (512 * 2 ** (camera.zoom - tileZoom));
  const bearing = (camera.bearing * Math.PI) / 180;
  const [x, y] = toTile(camera.center[0], camera.center[1], tileZoom);
  // Towards the camera: against the way it looks (x east, y south).
  return [x - Math.sin(bearing) * offsetTiles, y + Math.cos(bearing) * offsetTiles];
}

/** The building tiles a camera will draw once it has arrived. */
export function tilesForView(camera: ViewCamera, tileZoom: number, maxTiles: number) {
  return tilesToDraw({ camera: groundAtFoot(camera, tileZoom), center: toTile(camera.center[0], camera.center[1], tileZoom), maxTiles });
}

/** How far a newly drawn tile's buildings have risen from the ground, 0 to 1, eased out. */
export function riseAt(ageMs: number, riseMs: number) {
  if (riseMs <= 0) return 1;
  const t = Math.min(1, Math.max(0, ageMs / riseMs));
  return 1 - (1 - t) ** 3;
}

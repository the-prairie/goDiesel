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

/**
 * A route's recorded trace as a shape in a 0–100 box, for the pixel map.
 * North is up (y grows southward), longitude is scaled by the cosine of the
 * mean latitude so shapes keep their proportions, the longer side spans the
 * whole box and the shorter side is centred.
 */
export function normaliseRouteLine(
  points: ReadonlyArray<{ lat: number; lng: number }>,
  maxPoints = 96,
): Array<[number, number]> {
  if (points.length === 0) return [];
  const sampled = thin(points, Math.max(2, maxPoints));
  const meanLat = sampled.reduce((sum, point) => sum + point.lat, 0) / sampled.length;
  const lngScale = Math.cos((meanLat * Math.PI) / 180);
  const planar = sampled.map((point) => [point.lng * lngScale, -point.lat] as const);

  const minX = Math.min(...planar.map(([x]) => x));
  const maxX = Math.max(...planar.map(([x]) => x));
  const minY = Math.min(...planar.map(([, y]) => y));
  const maxY = Math.max(...planar.map(([, y]) => y));
  const span = Math.max(maxX - minX, maxY - minY);
  if (span === 0) return planar.map(() => [50, 50]);

  const scale = 100 / span;
  const offsetX = (100 - (maxX - minX) * scale) / 2;
  const offsetY = (100 - (maxY - minY) * scale) / 2;
  return planar.map(([x, y]) => [
    clampToBox(offsetX + (x - minX) * scale),
    clampToBox(offsetY + (y - minY) * scale),
  ]);
}

/** Floating-point rounding can land a hair outside the box. */
function clampToBox(value: number) {
  return Math.min(100, Math.max(0, value));
}

/** At most `limit` points, evenly spaced by index, always keeping both ends. */
function thin<T>(points: ReadonlyArray<T>, limit: number): T[] {
  if (points.length <= limit) return [...points];
  const step = (points.length - 1) / (limit - 1);
  return Array.from({ length: limit }, (_, index) => points[Math.round(index * step)]);
}

// Her routes for the real-geometry sketch's corridor: the shader measures
// each pixel's distance to a fixed number of route stretches, so it gets
// the stretches nearest the middle of the view, in metres on a local
// ground plane.

export const MAX_SEGMENTS = 96;

type P = readonly [number, number];

export function nearestSegments(lines: readonly (readonly P[])[], centre: P): [number, number, number, number][] {
  const all: { s: [number, number, number, number]; d: number }[] = [];
  for (const line of lines)
    for (let i = 1; i < line.length; i += 1) {
      const [ax, ay] = line[i - 1];
      const [bx, by] = line[i];
      const dx = bx - ax;
      const dy = by - ay;
      const length2 = dx * dx + dy * dy;
      const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((centre[0] - ax) * dx + (centre[1] - ay) * dy) / length2));
      all.push({ s: [ax, ay, bx, by], d: Math.hypot(ax + t * dx - centre[0], ay + t * dy - centre[1]) });
    }
  if (all.length <= MAX_SEGMENTS) return all.map((item) => item.s);
  return all
    .sort((a, b) => a.d - b.d)
    .slice(0, MAX_SEGMENTS)
    .map((item) => item.s);
}

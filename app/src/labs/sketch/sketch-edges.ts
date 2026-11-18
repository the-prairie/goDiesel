// A building's drawn edges: its roof outline, its base, and the corners
// where its walls meet at a real angle. A wall that only bends a little, as
// round a curved building, gets no corner line, as an architect would draw
// it. Coordinates are whatever plane the caller uses; heights are the same
// units as the third value of each segment.

/** Walls meeting at less than this many degrees off straight draw no corner. */
const CORNER_DEGREES = 28;

/** Segments as (x1, y1, z1, x2, y2, z2) for a footprint's outer ring and holes. */
export function buildingEdges(rings: readonly (readonly [number, number][])[], height: number, minHeight: number): Float32Array {
  if (height <= minHeight) return new Float32Array();
  const out: number[] = [];
  rings.forEach((raw, ringIndex) => {
    const ring = raw.length > 1 && raw[0][0] === raw[raw.length - 1][0] && raw[0][1] === raw[raw.length - 1][1] ? raw.slice(0, -1) : raw;
    const n = ring.length;
    if (n < 3) return;
    for (let i = 0; i < n; i += 1) {
      const a = ring[i];
      const b = ring[(i + 1) % n];
      out.push(a[0], a[1], height, b[0], b[1], height);
      // The base of the outer wall; a courtyard's floor is hidden anyway.
      if (ringIndex === 0) out.push(a[0], a[1], minHeight, b[0], b[1], minHeight);
      if (ringIndex !== 0) continue;
      const before = ring[(i - 1 + n) % n];
      const inX = a[0] - before[0];
      const inY = a[1] - before[1];
      const outX = b[0] - a[0];
      const outY = b[1] - a[1];
      const turn = Math.abs(Math.atan2(inX * outY - inY * outX, inX * outX + inY * outY)) * (180 / Math.PI);
      if (turn >= CORNER_DEGREES) out.push(a[0], a[1], minHeight, a[0], a[1], height);
    }
  });
  return new Float32Array(out);
}

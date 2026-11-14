// The top of each drawn building (its roof, rooftop boxes included), so a
// planted moment's marker can stand on the roof that is actually drawn: the
// heights are invented by rule where the data has none (sketch-massing).
// Per tile, five floats a building: its box in tile units, then its top in metres.

export const TOP_STRIDE = 5;
const FACE_STRIDE = 9;

/** The highest point of one building's faces (nine floats a vertex, z third). */
export function topOf(faces: Float32Array) {
  let top = 0;
  for (let i = 2; i < faces.length; i += FACE_STRIDE) if (faces[i] > top) top = faces[i];
  return top;
}

/** The roof under a point in tile units: the smallest building whose box holds it, or null. */
export function roofAt(tops: Float32Array, x: number, y: number) {
  let best: number | null = null;
  let area = Infinity;
  for (let i = 0; i < tops.length; i += TOP_STRIDE) {
    if (x < tops[i] || y < tops[i + 1] || x > tops[i + 2] || y > tops[i + 3]) continue;
    const size = (tops[i + 2] - tops[i]) * (tops[i + 3] - tops[i + 1]);
    if (size < area) {
      area = size;
      best = tops[i + 4];
    }
  }
  return best;
}

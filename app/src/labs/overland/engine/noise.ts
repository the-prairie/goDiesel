// Deterministic hashing and value noise. The same route always grows the
// same terrain around her line.

export function hash(value: string | number) {
  const text = String(value);
  let h = 2166136261 >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    h ^= text.charCodeAt(index);
    h = Math.imul(h, 16777619) >>> 0;
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995) >>> 0;
  h ^= h >>> 15;
  return h >>> 0;
}

function valueNoise(seed: number, cell: number) {
  const grid = new Map<string, number>();
  const at = (ix: number, iy: number) => {
    const key = `${ix},${iy}`;
    let value = grid.get(key);
    if (value === undefined) {
      value = (hash(`${seed}:${key}`) % 10_000) / 10_000;
      grid.set(key, value);
    }
    return value;
  };
  return (x: number, y: number) => {
    const fx = x / cell;
    const fy = y / cell;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = fx - ix;
    const ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * sx;
    const bottom = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * sx;
    return top + (bottom - top) * sy;
  };
}

/** Three octaves of value noise, in 0..1. */
export function fbm(seed: number, cell: number) {
  const a = valueNoise(seed, cell);
  const b = valueNoise(seed + 11, cell / 2);
  const c = valueNoise(seed + 23, cell / 4);
  return (x: number, y: number) => a(x, y) * 0.58 + b(x, y) * 0.28 + c(x, y) * 0.14;
}

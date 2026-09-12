import { Vector3, type PerspectiveCamera } from "three";

export interface WorldRasterCoverage {
  /** Legacy bands retained for comparison, not enough to qualify a view. */
  ground: number;
  broad: number;
  expectedPixels: number;
  groundCoverage: number;
  worstCellCoverage: number;
  largestHoleFraction: number;
  usable: boolean;
  missingGroundSamples: Array<{ xNdc: number; yNdc: number; missingPixels: number }>;
}

/**
 * Measure terrain-only alpha, never final RGB, UI, clouds or label pixels.
 * Camera-relative downward rays define the expected ground field; intentional
 * sky is excluded geometrically, not by its color. This measures completeness,
 * not texture sharpness, geographic accuracy, or artistic quality.
 */
export function measureWorldRaster(pixels: Uint8Array, width: number, height: number,
  camera: PerspectiveCamera): WorldRasterCoverage {
  if (width < 1 || height < 1 || pixels.length !== width * height * 4) {
    throw new RangeError("Terrain raster dimensions do not match RGBA pixels");
  }
  const missing = new Uint8Array(width * height);
  const totals = new Uint32Array(48), filled = new Uint32Array(48);
  let expectedPixels = 0, hits = 0, groundTotal = 0, groundHits = 0, broadTotal = 0, broadHits = 0;
  const ray = new Vector3(), up = camera.up.clone().normalize();
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = (x + .5) / width, v = (y + .5) / height;
    const opaque = pixels[(y * width + x) * 4 + 3] > 240;
    if (u >= .05 && u < .95 && v >= 10/90 && v < 76/90) {
      broadTotal++; if (opaque) broadHits++;
      if (u >= 10/160 && u < 150/160 && v >= 25/90 && v < 61/90) {
        groundTotal++; if (opaque) groundHits++;
      }
    }
    // Leave a small edge guard for rasterization, not a large untested horizon.
    if (u < .025 || u > .975 || v < .025 || v > .975) continue;
    ray.set(u * 2 - 1, v * 2 - 1, .5).unproject(camera).sub(camera.position).normalize();
    if (ray.dot(up) >= -.02) continue;
    const cell = Math.min(5, Math.floor(v * 6)) * 8 + Math.min(7, Math.floor(u * 8));
    totals[cell]++; expectedPixels++;
    if (opaque) { filled[cell]++; hits++; }
    else missing[y * width + x] = 1;
  }
  // Four-connected empty pixels reject a single large tear that an average hides.
  const queue = new Uint32Array(width * height);
  let largestHole = 0;
  for (let start = 0; start < missing.length; start++) {
    if (!missing[start]) continue;
    let head = 0, tail = 1; queue[0] = start; missing[start] = 0;
    while (head < tail) {
      const index = queue[head++], x = index % width;
      for (const next of [x > 0 ? index - 1 : -1, x + 1 < width ? index + 1 : -1,
        index >= width ? index - width : -1, index + width < missing.length ? index + width : -1]) {
        if (next < 0 || !missing[next]) continue;
        missing[next] = 0; queue[tail++] = next;
      }
    }
    largestHole = Math.max(largestHole, tail);
  }
  const cells = [...totals].flatMap((count, i) => count >= 16 ? [filled[i] / count] : []);
  const groundCoverage = expectedPixels ? hits / expectedPixels : 0;
  const worstCellCoverage = cells.length ? Math.min(...cells) : 0;
  const largestHoleFraction = expectedPixels ? largestHole / expectedPixels : 1;
  return {
    ground: groundTotal ? groundHits / groundTotal : 0,
    broad: broadTotal ? broadHits / broadTotal : 0,
    expectedPixels, groundCoverage, worstCellCoverage, largestHoleFraction,
    missingGroundSamples: [...totals].flatMap((count,i)=>count>=16 && filled[i]/count<.98 ? [{
      xNdc:((i%8)+.5)/8*2-1, yNdc:(Math.floor(i/8)+.5)/6*2-1, missingPixels:count-filled[i],
    }]:[]).sort((a,b)=>b.missingPixels-a.missingPixels).slice(0,4),
    usable: expectedPixels >= 100 && groundCoverage >= .98 && worstCellCoverage >= .90 && largestHoleFraction <= .01,
  };
}

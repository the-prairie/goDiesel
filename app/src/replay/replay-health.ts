const TILE_FAILURE_WINDOW_MS = 15_000;

export function recordTileFailure(
  failures: readonly number[],
  nowMs: number,
  windowMs = TILE_FAILURE_WINDOW_MS,
) {
  return [...failures.filter((failureMs) => nowMs - failureMs <= windowMs), nowMs];
}

export function rgbaPixelsLookBlank(
  pixels: Uint8Array,
  minimumBrightness = 18,
  maximumVisibleRatio = 0.03,
) {
  if (pixels.length < 4) return false;
  let visiblePixels = 0;
  let totalPixels = 0;
  for (let index = 0; index + 3 < pixels.length; index += 4) {
    if (pixels[index] + pixels[index + 1] + pixels[index + 2] > minimumBrightness) {
      visiblePixels += 1;
    }
    totalPixels += 1;
  }
  return totalPixels > 0 && visiblePixels / totalPixels < maximumVisibleRatio;
}

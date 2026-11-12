// The timing and the pattern of the jump's transitions. The cover is our
// pixel art over the live map; it clears in blocks by an ordered dither,
// like an old handheld's screen fade, and nothing here touches the map.

/** One step of the wipe; eight of them clear the cover in 760 ms. */
export const WIPE_STEP_MS = 95;
/** The dive from the entry's little map to the whole screen. */
export const DIVE_MS = 420;
/** With reduced motion, the only transition is a crossfade this long. */
export const CROSSFADE_MS = 200;

const BAYER_4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const;

/** A cell's place in the 4 × 4 ordered dither, from 0 to 15. */
export function ditherRank(x: number, y: number) {
  return BAYER_4[((y % 4) + 4) % 4][((x % 4) + 4) % 4];
}

/**
 * Whether a cell of the cover is still drawn when `coverage` of it is left
 * (1 is fully covered, 0 fully clear). Each tile of 16 cells keeps exactly
 * that share, and a cell once cleared stays clear as coverage falls.
 */
export function cellCovered(x: number, y: number, coverage: number) {
  return ditherRank(x, y) < Math.round(coverage * 16);
}

/** CSS pixels per cover pixel: about 130 to 240 cover pixels across. */
export function coverPixelScale(viewportWidth: number) {
  return Math.max(3, Math.ceil(viewportWidth / 240));
}

export interface PixelRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A rectangle in CSS pixels as cover pixels, grown to whole pixels. */
export function nativeRect(rect: PixelRect, k: number): PixelRect {
  const left = Math.floor(rect.left / k);
  const top = Math.floor(rect.top / k);
  return {
    left,
    top,
    width: Math.ceil((rect.left + rect.width) / k) - left,
    height: Math.ceil((rect.top + rect.height) / k) - top,
  };
}

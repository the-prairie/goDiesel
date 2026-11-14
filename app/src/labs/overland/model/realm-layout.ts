// Where the pixel text box and the controls sit over the 3D world. Google's
// logo and credits live in the bottom corners of the map; nothing of ours
// may sit over them, so the bottom band is left to the map.

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface RealmViewport {
  width: number;
  height: number;
  safe: Insets;
}

/** The height of the bottom band that holds the provider's attribution. */
export const ATTRIBUTION_BAND_PX = 36;
/** The smallest touch target. */
export const CONTROL_TARGET_PX = 44;
const CONTROLS_HEIGHT = 56;
const EDGE = 12;
const GAP = 8;
const TEXT_BOX_MAX = 480;
const CONTROLS_MAX = 560;

/** The bottom-left and bottom-right corners of the map, meeting in the middle. */
export function attributionCorners({ width, height }: Pick<RealmViewport, "width" | "height">): [Rect, Rect] {
  const top = height - ATTRIBUTION_BAND_PX;
  const half = width / 2;
  return [
    { left: 0, top, width: half, height: ATTRIBUTION_BAND_PX },
    { left: half, top, width: width - half, height: ATTRIBUTION_BAND_PX },
  ];
}

export function rectsIntersect(a: Rect, b: Rect) {
  return a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
}

/**
 * The text box at the top, inside the safe area; the controls above the
 * attribution band or the home indicator, whichever is taller.
 */
export function realmLayout({ width, height, safe }: RealmViewport, textBoxHeight: number) {
  const safeWidth = width - safe.left - safe.right;
  const textWidth = Math.min(safeWidth - 2 * EDGE, TEXT_BOX_MAX);
  const textBox: Rect = { left: safe.left + EDGE, top: safe.top + EDGE, width: textWidth, height: textBoxHeight };
  const controlsWidth = Math.min(safeWidth - 2 * EDGE, CONTROLS_MAX);
  const bottom = height - Math.max(ATTRIBUTION_BAND_PX, safe.bottom) - GAP;
  const controls: Rect = {
    left: safe.left + (safeWidth - controlsWidth) / 2,
    top: bottom - CONTROLS_HEIGHT,
    width: controlsWidth,
    height: CONTROLS_HEIGHT,
  };
  return { textBox, controls };
}

const LEAVE_PX = 44;
/** The ridge line's drawing: the readout above, the ridge, kilometre ticks below. */
const RIDGE_PX = 156;

/**
 * The sketch skin's replay: leaving top-left, the route card beside it, and
 * the ridge line edge to edge along the bottom on paper, above the home
 * indicator. Google's map ends where the ridge begins, so its credit, which
 * Map3DElement draws at the map's bottom and cannot move, stands on the map
 * just above the ridge, uncovered.
 */
export function sketchRealmLayout({ width, height, safe }: RealmViewport) {
  const leave: Rect = { left: safe.left + EDGE, top: safe.top + EDGE, width: LEAVE_PX, height: LEAVE_PX };
  const cardLeft = leave.left + LEAVE_PX + GAP;
  const card: Rect = { left: cardLeft, top: leave.top, width: Math.min(width - safe.right - EDGE - cardLeft, TEXT_BOX_MAX), height: 0 };
  const ridgeHeight = RIDGE_PX + safe.bottom;
  const ridge: Rect = { left: 0, top: height - ridgeHeight, width, height: ridgeHeight };
  const ridgeLine: Rect = { left: 0, top: ridge.top, width, height: RIDGE_PX };
  const map: Rect = { left: 0, top: 0, width, height: ridge.top };
  return { leave, card, ridge, ridgeLine, map };
}

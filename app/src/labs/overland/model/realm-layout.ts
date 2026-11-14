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
const TRANSPORT_HEIGHT = 76;
/** Clear space kept between our controls and the provider's credit. */
const CREDIT_CLEAR = 12;

/**
 * The sketch skin's replay: leaving top-left, the route card beside it, and
 * the transport above Google's credit with clear space and above the home
 * indicator. Playback and navigation are separate controls.
 */
export function sketchRealmLayout({ width, height, safe }: RealmViewport) {
  const safeWidth = width - safe.left - safe.right;
  const leave: Rect = { left: safe.left + EDGE, top: safe.top + EDGE, width: LEAVE_PX, height: LEAVE_PX };
  const cardLeft = leave.left + LEAVE_PX + GAP;
  const card: Rect = { left: cardLeft, top: leave.top, width: Math.min(width - safe.right - EDGE - cardLeft, TEXT_BOX_MAX), height: 0 };
  const transportWidth = Math.min(safeWidth - 2 * EDGE, CONTROLS_MAX);
  const bottom = height - Math.max(ATTRIBUTION_BAND_PX + CREDIT_CLEAR, safe.bottom + GAP);
  const transport: Rect = {
    left: safe.left + (safeWidth - transportWidth) / 2,
    top: bottom - TRANSPORT_HEIGHT,
    width: transportWidth,
    height: TRANSPORT_HEIGHT,
  };
  return { leave, card, transport };
}

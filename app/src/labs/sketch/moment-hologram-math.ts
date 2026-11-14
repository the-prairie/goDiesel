// The planted moment's marker, as numbers: a beacon from city zoom (a column
// of light from the roof, a ring and a pool), a hologram television at street
// zoom, and one continuous change between. Pure, so it is tested on its own.

/** Below this the marker is all beacon; above NEAR_ZOOM, all hologram. Picked by eye in Kyoto. */
export const FAR_ZOOM = 14.6;
export const NEAR_ZOOM = 16.8;
/** The hit area, in CSS pixels (points on a phone). */
export const HIT_PT = 44;

const smooth = (t: number) => t * t * (3 - 2 * t);

/** 0 at city zoom, 1 at street zoom. */
export function zoomBlend(zoom: number) {
  const t = Math.min(1, Math.max(0, (zoom - FAR_ZOOM) / (NEAR_ZOOM - FAR_ZOOM)));
  return smooth(t);
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Sizes in metres at blend t, given the metres a pixel spans there. From far
 * the beam, ring and pool keep their size on screen; up close the television,
 * its cone and the pool are real sizes, so they sit on the roof like a thing.
 */
export function markerShape(t: number, metresPerPixel: number) {
  const px = (p: number) => p * metresPerPixel;
  // Its real size up close, but never under about 34 px across on the way in.
  const w = Math.max(9, px(34));
  return {
    beamLengthM: mix(px(150), 0, t),
    beamWidthM: mix(px(6), 0, t),
    ringM: mix(px(18), 4.5, t),
    poolM: mix(px(22), 6.5, t),
    // It fades in from nothing but scales in from half size, so it reads mid-approach.
    tvScale: t > 0 ? mix(0.55, 1, smooth(t)) : 0,
    tvAlpha: t,
    /** The television: width, height and depth in metres, floating this high above the roof. */
    tv: { w, h: w * 0.72, d: w * 0.55, liftM: w * 0.6 },
  };
}

/** The hit area centred on a screen point. */
export function hitBox({ x, y }: { x: number; y: number }) {
  return { left: x - HIT_PT / 2, top: y - HIT_PT / 2, width: HIT_PT, height: HIT_PT };
}

/** Whether any of these screen points (a marker's hit centre, its beam's top) is on screen, give or take half a hit area. */
export function inView(points: readonly { x: number; y: number }[], viewport: { width: number; height: number }) {
  const m = HIT_PT / 2;
  return points.some(({ x, y }) => x >= -m && y >= -m && x <= viewport.width + m && y <= viewport.height + m);
}

/** The motion at a moment in time: still (and a good angle) with reduced motion. */
export function motionAt(ms: number, reduced: boolean) {
  if (reduced) return { spin: 0.55, bobM: 0, pulse: 0.5, scan: 0 };
  return {
    spin: ((ms / 9000) % 1) * Math.PI * 2,
    bobM: Math.sin((ms / 3200) * Math.PI * 2) * 0.6,
    pulse: (ms / 2200) % 1,
    scan: (ms / 1100) % 1,
  };
}

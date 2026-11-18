import type { Placement } from "@/labs/sketch/moment-catalog";

// The hand-over from the map to a moment's drawn shop: the scene's first frame
// puts the drawing's shop front (its ground corners, on a 360×640 drawing)
// where the real building's front stands on screen at the approach camera,
// then pushes in from there. Pure, so the geometry is tested on its own.

/** The drawn shop front: its left and right edges and its ground line. */
export const SHOP = { left: 60, right: 300, ground: 520 };
/** The world's transform-origin, as in moment-tv-wall.css. */
const ORIGIN = { x: 0.439, y: 0.656 };

export interface ScreenFront {
  left: number;
  right: number;
  ground: number;
}

/** The real front's two ground corners, either side of its middle along the wall. */
export function frontCorners(placement: Pick<Placement, "at" | "facingDeg" | "frontM">) {
  const half = (placement.frontM ?? 20) / 2;
  const along = ((placement.facingDeg + 90) * Math.PI) / 180;
  const dLng = (Math.sin(along) * half) / (111320 * Math.cos((placement.at.lat * Math.PI) / 180));
  const dLat = (Math.cos(along) * half) / 110540;
  const { lng, lat } = placement.at;
  return [
    { lng: lng - dLng, lat: lat - dLat },
    { lng: lng + dLng, lat: lat + dLat },
  ] as const;
}

/**
 * The scene's start transform, `translate(tx, ty) scale(s)` after its centring,
 * or null when the front is too small or off screen to line up with.
 */
export function handoverTransform(front: ScreenFront, viewport: { width: number; height: number }) {
  const span = front.right - front.left;
  if (span < 24 || front.right < 0 || front.left > viewport.width || front.ground < 0 || front.ground > viewport.height) return null;
  const width = Math.min(viewport.width, (viewport.height * 9) / 16);
  const height = (width * 16) / 9;
  const left = viewport.width / 2 - width / 2;
  const top = viewport.height / 2 - height / 2;
  const ox = ORIGIN.x * width;
  const oy = ORIGIN.y * height;
  const s = span / (((SHOP.right - SHOP.left) / 360) * width);
  const px = (SHOP.left / 360) * width;
  const py = (SHOP.ground / 640) * height;
  return { tx: front.left - left - ox - s * (px - ox), ty: front.ground - top - oy - s * (py - oy), s, ox, oy, left, top, width, height };
}

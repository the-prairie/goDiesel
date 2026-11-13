// Choosing a signpost by touch: a tap on the scene picks the board under
// it, and a route chip chooses on the first tap and enters on the second,
// so a thumb never jumps by accident.

export interface SignOnScreen {
  slug: string;
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
}

/** How far off a board a tap still counts, in CSS pixels. */
const SLACK = 8;

export function signAtPoint(signs: readonly SignOnScreen[], x: number, y: number): string | null {
  let best: { slug: string; distance: number } | null = null;
  for (const sign of signs) {
    if (!sign.visible) continue;
    const inside = Math.abs(x - sign.x) <= sign.width / 2 + SLACK && Math.abs(y - sign.y) <= sign.height / 2 + SLACK;
    if (!inside) continue;
    const distance = Math.hypot(x - sign.x, y - sign.y);
    if (!best || distance < best.distance) best = { slug: sign.slug, distance };
  }
  return best?.slug ?? null;
}

export function chipTap(chosen: string | null, slug: string): "choose" | "enter" {
  return chosen === slug ? "enter" : "choose";
}

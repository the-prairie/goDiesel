/**
 * Geometry for the polaroid fan.
 *
 * The cards are ordered by distance travelled, so the fan reads left to right
 * as the route was run: the leftmost card is the earliest point, the rightmost
 * the latest. Order carries the meaning.
 *
 * Spacing is presentational, not proportional. Photographs cluster — a single
 * video yields several frames a few metres apart — so spacing by true distance
 * would stack them into an unreadable pile. The kilometre mark is printed on
 * each card instead, where it can be read exactly.
 *
 * Rotation is decorative but deterministic, seeded from the route slug and the
 * card index. Math.random would reshuffle the fan on every render and make the
 * visual snapshots flake.
 */

export interface SplayPlacement {
  x: number;
  y: number;
  rotationDeg: number;
  zIndex: number;
}

export interface SplayOptions {
  /** Widest the fan may become, in pixels. The spacing shrinks to fit. */
  containerWidth: number;
  /** Card width, so the fan can keep at least part of every card visible. */
  cardWidth: number;
  /** Seeded so a given route always fans the same way. */
  seed: string;
  /** Reduced motion and small containers ask for a flat, square layout. */
  flat?: boolean;
}

const MAX_ROTATION_DEG = 9;
// Cards overlap enough to read as a handled stack, but never enough to cover
// the caption of the card beneath. A truncated kilometre mark is a defect, not
// a style: the white strip is where the evidence lives.
const MAX_SPACING_RATIO = 0.94;
const MIN_SPACING_RATIO = 0.24;
const ARC_LIFT_PX = 18;

/** A small deterministic hash, so a seed maps to a stable number in [0, 1). */
export function seededUnitValue(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 100000) / 100000;
}

/**
 * Place one card. `index` is its position in route order and `count` is the
 * total, so the fan stays centred whatever its size.
 */
export function splayPlacement(
  index: number,
  count: number,
  options: SplayOptions,
): SplayPlacement {
  const { containerWidth, cardWidth, seed, flat = false } = options;

  if (count <= 0) {
    return { x: 0, y: 0, rotationDeg: 0, zIndex: 0 };
  }
  if (count === 1) {
    return { x: 0, y: 0, rotationDeg: 0, zIndex: 0 };
  }

  // Never let the fan exceed the container. Overlap tightens as cards are
  // added rather than the fan growing past its bounds.
  const available = Math.max(containerWidth - cardWidth, 0);
  const idealSpacing = cardWidth * MAX_SPACING_RATIO;
  const spacing = Math.max(
    Math.min(idealSpacing, count > 1 ? available / (count - 1) : idealSpacing),
    cardWidth * MIN_SPACING_RATIO,
  );

  const centre = (count - 1) / 2;
  const fromCentre = index - centre;
  const x = fromCentre * spacing;

  if (flat) {
    return { x, y: 0, rotationDeg: 0, zIndex: index };
  }

  // Cards away from the centre lift slightly, the way a fanned hand of cards
  // curves. Normalised so the arc looks the same at any count.
  const normalised = centre === 0 ? 0 : fromCentre / centre;
  const y = Math.abs(normalised) * ARC_LIFT_PX;

  // A base tilt follows the fan, plus a small seeded wobble so the stack looks
  // handled rather than machined.
  const wobble = seededUnitValue(`${seed}:${index}`) * 2 - 1;
  const rotationDeg =
    normalised * MAX_ROTATION_DEG * 0.7 + wobble * MAX_ROTATION_DEG * 0.3;

  return { x, y, rotationDeg, zIndex: index };
}

/** Place every card. */
export function splayFan(count: number, options: SplayOptions): SplayPlacement[] {
  return Array.from({ length: count }, (_, index) =>
    splayPlacement(index, count, options),
  );
}

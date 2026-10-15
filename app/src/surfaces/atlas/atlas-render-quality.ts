// Retain crisp edges on Retina displays without allocating an unbounded 3x
// framebuffer. Resolution affects fill rate quadratically.
export function atlasResolutionScale(width: number, height: number, pixelRatio: number) {
  const pixelBudget = 2_500_000;
  const area = Math.max(1, width) * Math.max(1, height);
  return Math.max(1, Math.min(pixelRatio || 1, 1.5, Math.sqrt(pixelBudget / area)));
}

// Transition from the regional oblique view to a centered orbital view. This
// constrains framing only; geography and route coordinates remain untouched.
export function atlasOrbitalPitchLimit(heightM: number) {
  const ratio = Math.max(0, Math.min(1, (heightM - 1_000_000) / 4_000_000));
  const eased = ratio * ratio * (3 - 2 * ratio);
  return -1.02 + (-Math.PI / 2 + 1.02) * eased;
}

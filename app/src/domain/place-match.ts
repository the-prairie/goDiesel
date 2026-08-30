export function normalizePlace(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function placesOverlap(left: string, right: string) {
  const normalizedLeft = normalizePlace(left);
  const normalizedRight = normalizePlace(right);
  return Boolean(normalizedLeft && normalizedRight) && (
    normalizedLeft === normalizedRight ||
    normalizedLeft.includes(normalizedRight) ||
    normalizedRight.includes(normalizedLeft)
  );
}

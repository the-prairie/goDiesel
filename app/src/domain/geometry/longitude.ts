export function normalizeLongitude(longitude: number) {
  return longitude >= -180 && longitude <= 180
    ? longitude
    : ((((longitude + 180) % 360) + 360) % 360) - 180;
}

export function shortestLongitudeDelta(from: number, to: number) {
  return normalizeLongitude(to - from);
}

export function interpolateLongitude(from: number, to: number, ratio: number) {
  return normalizeLongitude(from + shortestLongitudeDelta(from, to) * ratio);
}

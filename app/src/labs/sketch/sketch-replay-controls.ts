// The sketch skin's replay transport and position marker: pure rules, so the
// realm component only renders them.

/** Where a key moves the scrubber, or null for keys it ignores. */
export function scrubKeyTarget(event: { key: string; shiftKey: boolean }, progressM: number, totalM: number): number | null {
  const step = (fraction: number) => Math.min(totalM, Math.max(0, progressM + fraction * totalM));
  const small = event.shiftKey ? 0.05 : 0.01;
  switch (event.key) {
    case "ArrowRight":
    case "ArrowUp":
      return step(small);
    case "ArrowLeft":
    case "ArrowDown":
      return step(-small);
    case "PageUp":
      return step(0.1);
    case "PageDown":
      return step(-0.1);
    case "Home":
      return 0;
    case "End":
      return totalM;
    default:
      return null;
  }
}

const NEAR_M = 300;
const FAR_M = 20_000;
const NEAR_PX = 32;
const FAR_PX = 18;

/**
 * The marker's size on screen for the camera's range: a location puck, not a
 * figure, so it never reads as a body standing over the city. Larger close
 * up, smaller over the whole route, log-scaled between.
 */
export function markerSize(rangeM: number | undefined) {
  if (rangeM === undefined || !Number.isFinite(rangeM)) return 24;
  const t = Math.min(1, Math.max(0, Math.log(rangeM / NEAR_M) / Math.log(FAR_M / NEAR_M)));
  return Math.round(NEAR_PX + (FAR_PX - NEAR_PX) * t);
}

/** The heading arrow's turn on screen: the route's bearing seen from the camera's heading, in −180..180. */
export function markerRotation(routeBearingDeg: number, cameraHeadingDeg: number) {
  const turn = (((routeBearingDeg - cameraHeadingDeg) % 360) + 540) % 360 - 180;
  return Math.round(turn * 10) / 10;
}

/** The route's compass bearing at a distance along it, from the segment she is on. */
export function bearingAt(route: readonly { lat: number; lng: number; d: number }[], progressM: number) {
  if (route.length < 2) return 0;
  let index = route.findIndex((point) => point.d > progressM);
  if (index <= 0) index = index === 0 ? 1 : route.length - 1;
  const a = route[index - 1];
  const b = route[index];
  const rad = Math.PI / 180;
  const y = Math.sin((b.lng - a.lng) * rad) * Math.cos(b.lat * rad);
  const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lng - a.lng) * rad);
  return ((Math.atan2(y, x) / rad) + 360) % 360;
}

const svgCache = new Map<string, string>();

/**
 * The position marker as an image: her red puck with a white ring, a soft
 * dark halo so it holds on pale streets, and a white heading arrow. Google's
 * 3D markers take image content, so a new image is made only when its size
 * or its 5° heading step changes.
 */
export function positionMarkerImage(size: number, rotateDeg: number) {
  const turn = Math.round(rotateDeg / 5) * 5;
  const key = `${size}/${turn}`;
  let url = svgCache.get(key);
  if (!url) {
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="-50 -50 100 100">` +
      `<circle r="48" fill="rgba(16,22,24,0.28)"/><circle r="43" fill="#fff"/><circle r="33" fill="#d9412b"/>` +
      `<path d="M0-22 15 13 0 5-15 13Z" fill="#fff" stroke="#fff" stroke-width="3" stroke-linejoin="round" transform="rotate(${turn})"/></svg>`;
    url = `data:image/svg+xml,${encodeURIComponent(svg)}`;
    svgCache.set(key, url);
  }
  return { url, turn };
}

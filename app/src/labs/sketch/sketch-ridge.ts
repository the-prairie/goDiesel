// The ridge line: the replay's playback control is the route's own profile,
// drawn along the bottom. These are its pure rules; the realm draws them.

type Point = { d: number; elev: number; elapsedS?: number };

const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Elevation, time and distance at a distance along the route, between points. */
export function sampleRidge(route: readonly Point[], at: number) {
  const total = route[route.length - 1].d;
  const d = clamp(at, 0, total);
  let lo = 0;
  let hi = route.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (route[mid].d <= d) lo = mid;
    else hi = mid;
  }
  const a = route[lo];
  const b = route[hi];
  const t = b.d > a.d ? (d - a.d) / (b.d - a.d) : 0;
  const elapsedS = a.elapsedS !== undefined && b.elapsedS !== undefined ? lerp(a.elapsedS, b.elapsedS, t) : undefined;
  return { d, elev: lerp(a.elev, b.elev, t), elapsedS, index: lo };
}

const ZOOM_SPAN_M = 6000;

/** The stretch of route the ridge shows: all of it at rest, the 6 km round her when zoomed (0..1, eased). */
export function ridgeWindow({ totalM, progressM, zoom }: { totalM: number; progressM: number; zoom: number }) {
  const span = lerp(totalM, Math.min(ZOOM_SPAN_M, totalM), zoom);
  const centre = clamp(lerp(totalM / 2, progressM, zoom), span / 2, totalM - span / 2);
  return { d0: centre - span / 2, span };
}

/** Lowest and highest elevation drawn: a flat run stays a calm, low ridge (at least 80 m of range at rest, 40 m zoomed). */
export function verticalRange(elevations: readonly number[], zoom: number) {
  const lo = Math.min(...elevations);
  const hi = Math.max(...elevations);
  return { lo, hi: Math.max(hi, lo + lerp(80, 40, zoom)) };
}

const DEAD_BAND = 0.012;

/** The grade at each of evenly spaced samples, smoothed over about nine of them; flat within ±1.2%. */
export function gradesOf(elevations: readonly number[], spacingM: number) {
  const n = elevations.length;
  return elevations.map((_, k) => {
    const a = Math.max(0, k - 4);
    const b = Math.min(n - 1, k + 5);
    const grade = b > a ? (elevations[b] - elevations[a]) / (spacingM * (b - a)) : 0;
    return Math.abs(grade) < DEAD_BAND ? 0 : grade;
  });
}

const SAND: [number, number, number] = [222, 190, 146];
const RED: [number, number, number] = [190, 40, 26];
const SAGE: [number, number, number] = [118, 152, 140];
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(lerp(v, b[i], t))) as [number, number, number];

/** Effort: sand on the flat, red deepening as the climb steepens (full at 12%), sage going down (full at −10%). */
export function effortColour(grade: number): [number, number, number] {
  return grade >= 0 ? mix(SAND, RED, Math.pow(clamp(grade / 0.12), 0.6)) : mix(SAND, SAGE, clamp(-grade / 0.1));
}

/** Where she stood still four minutes or more: time spent beyond her moving pace, from recorded time against distance. */
export function findStops(route: readonly Point[], minMinutes = 4) {
  if (route.length < 3 || route.some((p) => p.elapsedS === undefined)) return [];
  const paces: number[] = [];
  for (let i = 1; i < route.length; i += 1) {
    const dd = route[i].d - route[i - 1].d;
    if (dd > 0) paces.push((route[i].elapsedS! - route[i - 1].elapsedS!) / dd);
  }
  paces.sort((a, b) => a - b);
  const pace = paces[Math.floor(paces.length / 2)] ?? 0;
  const stops: { d: number; minutes: number }[] = [];
  let current: { d: number; seconds: number } | null = null;
  for (let i = 1; i < route.length; i += 1) {
    const excess = route[i].elapsedS! - route[i - 1].elapsedS! - (route[i].d - route[i - 1].d) * pace;
    if (excess >= 60) {
      if (current) current.seconds += excess;
      else current = { d: route[i - 1].d, seconds: excess };
    } else if (current) {
      if (current.seconds >= minMinutes * 60) stops.push({ d: current.d, minutes: Math.round(current.seconds / 60) });
      current = null;
    }
  }
  if (current && current.seconds >= minMinutes * 60) stops.push({ d: current.d, minutes: Math.round(current.seconds / 60) });
  return stops;
}

/** The time of day she was there, in the route's own time zone, or null when the route has no recorded time. */
export function clockAt(startTimeUtc: string | undefined, elapsedS: number | undefined, timeZone: string | undefined) {
  if (!startTimeUtc || elapsedS === undefined || !timeZone) return null;
  const at = Date.parse(startTimeUtc) + elapsedS * 1000;
  if (!Number.isFinite(at)) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone }).formatToParts(at);
    const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    return `${part("hour")}:${part("minute")} ${part("dayPeriod").toLowerCase()}`;
  } catch {
    return null;
  }
}

/** Kilometres between ticks, so no more than about eight show. */
export function tickStep(spanM: number) {
  return [1, 2, 5, 10, 25, 50, 100].find((step) => spanM / 1000 / step <= 8) ?? 100;
}

/** Where a touch at x puts her, at rest. */
export function progressAtX(x: number, width: number, view: { d0: number; span: number }) {
  return view.d0 + (clamp(x, 0, width) / width) * view.span;
}

/** Where dragging by dx moves her, relative, as when zoomed. */
export function scrubBy(progressM: number, dx: number, width: number, view: { d0?: number; span: number }, totalM: number) {
  return clamp(progressM + (dx / width) * view.span, 0, totalM);
}

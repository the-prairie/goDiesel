import type { GeographicContext } from "../src/domain/course-planning";

type Point = [number, number];
type Polygon = { rings: Point[][] };
type ObjectRecord = Record<string, unknown>;
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_ELEMENTS = 2_000;
const MAX_POINTS = 20_000;
const MAX_RING_POINTS = 2_048;
const MAX_MEMBERS = 256;
const CACHE_TTL_MS = 15 * 60_000;
const cache = new Map<string, { expires: number; context: GeographicContext }>();

function endpointFor(nextgisOverpassKey: string | undefined): string | undefined {
  if (nextgisOverpassKey === undefined) return "https://overpass.private.coffee/api/interpreter";
  if (!nextgisOverpassKey || nextgisOverpassKey.length > 1_024 ||
      /[\s\u0000-\u001f\u007f]/u.test(nextgisOverpassKey) || /^\.{1,2}$/.test(nextgisOverpassKey)) return;
  try {
    return `https://overpass.nextgis.com/${encodeURIComponent(nextgisOverpassKey)}/api/interpreter`;
  } catch {
    return;
  }
}

function record(value: unknown): ObjectRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as ObjectRecord : undefined;
}

function boundsFor(start: { lat: number; lng: number }, targetM: number) {
  const radius = Math.min(12_000, Math.max(500, targetM / 2 + 500));
  const latitude = radius / 111_000;
  const longitude = Math.min(180, latitude / Math.max(0.001, Math.cos(start.lat * Math.PI / 180)));
  return {
    west: Math.max(-180, start.lng - longitude),
    south: Math.max(-90, start.lat - latitude),
    east: Math.min(180, start.lng + longitude),
    north: Math.min(90, start.lat + latitude),
  };
}

function queryFor(bounds: GeographicContext["bounds"]) {
  const bbox = `(${bounds.south},${bounds.west},${bounds.north},${bounds.east})`;
  return `[out:json][timeout:6][maxsize:16777216];(` +
    `wr[leisure~"^(park|garden)$"][access!~"^(private|no)$"]${bbox};` +
    `wr[natural=water]${bbox};wr[waterway=riverbank]${bbox};wr[landuse=reservoir]${bbox};` +
    `way[waterway~"^(river|stream|canal)$"]${bbox};way[natural=coastline]${bbox};` +
    `);out geom ${MAX_ELEMENTS + 1};`;
}

function same(a: Point, b: Point) {
  return a[0] === b[0] && a[1] === b[1];
}

function closed(points: Point[]) {
  return points.length >= 4 && same(points[0], points[points.length - 1]);
}

function validRing(points: Point[]) {
  if (!closed(points)) return false;
  let area = 0;
  for (let i = 1; i < points.length; i++) {
    area += points[i - 1][0] * points[i][1] - points[i][0] * points[i - 1][1];
  }
  return area !== 0;
}

function inside(point: Point, ring: Point[]) {
  let contained = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > point[1]) !== (b[1] > point[1]) &&
        point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) {
      contained = !contained;
    }
  }
  return contained;
}

function joinRings(parts: Point[][]): Point[][] | undefined {
  const pending = parts.slice();
  const rings: Point[][] = [];
  while (pending.length) {
    let ring = pending.pop()!;
    while (!closed(ring)) {
      const end = ring[ring.length - 1];
      const matches = pending.flatMap((part, index) =>
        same(end, part[0]) || same(end, part[part.length - 1]) ? [index] : []);
      if (matches.length !== 1) return;
      const next = pending.splice(matches[0], 1)[0];
      ring = ring.concat((same(end, next[0]) ? next : next.slice().reverse()).slice(1));
      if (ring.length > MAX_RING_POINTS) return;
    }
    if (!validRing(ring)) return;
    rings.push(ring);
  }
  return rings;
}

function parseGeography(body: unknown, bounds: GeographicContext["bounds"]): GeographicContext {
  const context: GeographicContext = { status: "available", bounds, parks: [], water: [], waterways: [] };
  const root = record(body);
  if (!root || !Array.isArray(root.elements)) return { ...context, status: "unavailable" };
  if (root.remark || root.elements.length > MAX_ELEMENTS) context.status = "partial";
  const elements = root.elements.slice(0, MAX_ELEMENTS);
  let remainingPoints = MAX_POINTS;
  const geometry = (raw: unknown): Point[] | undefined => {
    if (!Array.isArray(raw) || raw.length < 2 || raw.length > MAX_RING_POINTS || raw.length > remainingPoints) return;
    remainingPoints -= raw.length;
    const points: Point[] = [];
    for (const item of raw) {
      const point = record(item);
      if (!point || typeof point.lon !== "number" || typeof point.lat !== "number" ||
          !Number.isFinite(point.lon) || !Number.isFinite(point.lat) || Math.abs(point.lon) > 180 || Math.abs(point.lat) > 90) return;
      points.push([point.lon, point.lat]);
    }
    // A planar ring spanning the antimeridian would fill the wrong side of the world.
    if (points.some((point, i) => i > 0 && Math.abs(point[0] - points[i - 1][0]) > 180)) return;
    return points;
  };
  const category = (tags: ObjectRecord) => {
    if (["park", "garden"].includes(String(tags.leisure)) && !["private", "no"].includes(String(tags.access))) return "parks";
    if (tags.natural === "water" || tags.waterway === "riverbank" || tags.landuse === "reservoir") return "water";
  };
  const memberWays = { parks: new Set<unknown>(), water: new Set<unknown>() };
  for (const raw of elements) {
    const element = record(raw), tags = record(element?.tags);
    if (!element || element.type !== "relation" || !tags) continue;
    const kind = category(tags);
    if (!kind) continue;
    const members = element.members;
    if (tags.type !== "multipolygon" || !Array.isArray(members) || !members.length || members.length > MAX_MEMBERS) {
      context.status = "partial";
      continue;
    }
    const outer: Point[][] = [], inner: Point[][] = [];
    let valid = true;
    for (const rawMember of members) {
      const member = record(rawMember);
      if (member?.type === "way") memberWays[kind].add(member.ref);
      if (!member || member.type !== "way" || !["outer", "inner", ""].includes(String(member.role))) {
        valid = false;
        continue;
      }
      const points = geometry(member.geometry);
      if (!points) { valid = false; continue; }
      (member.role === "inner" ? inner : outer).push(points);
    }
    const outers = valid ? joinRings(outer) : undefined;
    const inners = valid ? joinRings(inner) : undefined;
    if (!outers?.length || !inners) { context.status = "partial"; continue; }
    const polygons: Polygon[] = outers.map(ring => ({ rings: [ring] }));
    for (const hole of inners) {
      const owners = polygons.filter(polygon => inside(hole[0], polygon.rings[0]));
      if (owners.length !== 1) { valid = false; break; }
      owners[0].rings.push(hole);
    }
    if (valid) context[kind].push(...polygons);
    else context.status = "partial";
  }
  for (const raw of elements) {
    const element = record(raw), tags = record(element?.tags);
    if (!element || !tags) { context.status = "partial"; continue; }
    if (element.type === "relation") continue;
    if (element.type !== "way") { context.status = "partial"; continue; }
    const kind = category(tags);
    if (kind && memberWays[kind].has(element.id)) continue;
    const line = ["river", "stream", "canal"].includes(String(tags.waterway)) || tags.natural === "coastline";
    if (!kind && !line) continue;
    const points = geometry(element.geometry);
    if (!points || (kind && !validRing(points))) { context.status = "partial"; continue; }
    if (kind) context[kind].push({ rings: [points] });
    else context.waterways.push(points);
  }
  return context;
}

async function readResponse(response: Response, signal: AbortSignal) {
  if (!response.ok || Number(response.headers.get("Content-Length")) > MAX_BYTES) {
    void response.body?.cancel().catch(() => {});
    throw new Error("Geography unavailable");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Geography unavailable");
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error("Geography unavailable");
      chunks.push(value);
    }
    signal.throwIfAborted();
    const buffer = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(buffer)) as unknown;
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel();
  }
}

export async function loadCourseGeography(
  start: { lat: number; lng: number },
  targetM: number,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  nextgisOverpassKey?: string,
): Promise<GeographicContext> {
  signal.throwIfAborted();
  const bounds = boundsFor(start, targetM);
  const unavailable: GeographicContext = { status: "unavailable", bounds, parks: [], water: [], waterways: [] };
  if (!Number.isFinite(start.lat) || !Number.isFinite(start.lng) || Math.abs(start.lat) > 90 ||
      Math.abs(start.lng) > 180 || !Number.isFinite(targetM) || targetM <= 0) return unavailable;
  const endpoint = endpointFor(nextgisOverpassKey);
  if (!endpoint) return unavailable;
  const query = queryFor(bounds);
  const cacheKey = `${endpoint}\n${query}`;
  const now = Date.now();
  for (const [key, entry] of cache) if (entry.expires <= now) cache.delete(key);
  const hit = cache.get(cacheKey);
  if (hit) return structuredClone(hit.context);
  const controller = new AbortController();
  let rejectAbort: (reason: unknown) => void = () => {};
  const interrupted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const abort = () => {
    controller.abort(signal.reason);
    rejectAbort(signal.reason);
  };
  signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => {
    controller.abort();
    rejectAbort(new Error("Geography unavailable"));
  }, 8_000);
  try {
    const request = fetcher(endpoint, {
      method: "POST", redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", "User-Agent": "goDiesel/1.0 (+https://godiesel.pages.dev; personal route planning)" },
      body: new URLSearchParams({ data: query }),
      signal: controller.signal,
    }).then(response => readResponse(response, controller.signal));
    const body = await Promise.race([request, interrupted]);
    signal.throwIfAborted();
    const context = parseGeography(body, bounds);
    if (Date.now() - now >= 8_000) return unavailable;
    if (context.status === "available") {
      if (cache.size >= 8) cache.delete(cache.keys().next().value!);
      cache.set(cacheKey, { expires: Date.now() + CACHE_TTL_MS, context: structuredClone(context) });
    }
    return context;
  } catch {
    signal.throwIfAborted();
    return unavailable;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}

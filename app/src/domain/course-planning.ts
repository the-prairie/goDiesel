import { courseStats, type CoursePoint, type CourseVibe } from "./courses";

export interface RouteCandidate {
  points: CoursePoint[];
  surface: Array<{ from: number; to: number; kind: "paved" | "unpaved" | "unknown" }>;
  waytype: Array<{ from: number; to: number; kind: "path" | "road" | "unknown" }>;
}

type Coordinate = [number, number];
type Polygon = { rings: Coordinate[][] };
type Bounds = { west: number; south: number; east: number; north: number };

export interface GeographicContext {
  status: "available" | "partial" | "unavailable";
  bounds: Bounds;
  parks: Polygon[];
  water: Polygon[];
  waterways: Coordinate[][];
}

export interface CourseShare {
  matchedM: number;
  knownM: number;
  unknownM: number;
  share: number | null;
}

export type AssessmentDimension = "parks" | "waterfront" | "paved" | "quietEstimate" | "ascent";

export interface CourseSelection {
  requestedCount: number;
  uniqueCount: number;
  comparedCount: number;
  duplicateCount: number;
  rejectedCount: number;
  distanceError: number;
  distanceBand: "preferred" | "fallback";
  usedDimensions: AssessmentDimension[];
  ignoredDimensions: AssessmentDimension[];
  score: number;
}

export interface CourseAssessment {
  version: 1;
  distanceM: number;
  ascentM: number | null;
  geographyStatus: GeographicContext["status"];
  parks: CourseShare;
  waterfront: CourseShare;
  paved: CourseShare;
  quietEstimate: CourseShare;
  selection?: CourseSelection;
}

export interface AssessedCandidate {
  candidate: RouteCandidate;
  assessment: CourseAssessment;
}

export interface RankedCandidates {
  ranked: AssessedCandidate[];
  requestedCount: number;
  uniqueCount: number;
  comparedCount: number;
  duplicateCount: number;
  rejectedCount: number;
  usedDimensions: AssessmentDimension[];
  ignoredDimensions: AssessmentDimension[];
}

const radians = Math.PI / 180;
const metersPerDegree = 6_371_000 * radians;
const maxGeometryVertices = 20_000;
const shareKeys = ["parks", "waterfront", "paved", "quietEstimate"] as const;
const dimensions: AssessmentDimension[] = [...shareKeys, "ascent"];

function share(matchedM: number, knownM: number, distanceM: number): CourseShare {
  const known = Math.min(distanceM, Math.max(0, knownM));
  const matched = Math.min(known, Math.max(0, matchedM));
  return { matchedM: matched, knownM: known, unknownM: Math.max(0, distanceM - known), share: known > 0 ? matched / known : null };
}

function pathDistances(points: CoursePoint[]): number[] {
  const distances = [0];
  for (let index = 1; index < points.length; index += 1) {
    distances.push(distances[index - 1] + courseStats([[points[index - 1], points[index]]]).distanceM);
  }
  return distances;
}

function samplePath(points: CoursePoint[], distances: number[], count: number, endpoints = false): Coordinate[] {
  const total = distances.at(-1) ?? 0;
  if (!points.length || total <= 0) return [];
  let segment = 1;
  return Array.from({ length: count }, (_, index) => {
    const distance = total * (endpoints ? index / (count - 1) : (index + 0.5) / count);
    while (segment < distances.length - 1 && distances[segment] < distance) segment += 1;
    const fraction = (distance - distances[segment - 1]) / (distances[segment] - distances[segment - 1] || 1);
    const from = points[segment - 1];
    const to = points[segment];
    return [from.lng + (to.lng - from.lng) * fraction, from.lat + (to.lat - from.lat) * fraction];
  });
}

function intervalShare(
  intervals: Array<{ from: number; to: number; kind: string }>,
  distances: number[],
  matchedKind: string,
  otherKind: string,
): CourseShare {
  const events = [new Int32Array(distances.length), new Int32Array(distances.length), new Int32Array(distances.length)];
  for (const interval of intervals) {
    if (!Number.isInteger(interval.from) || !Number.isInteger(interval.to) || interval.from < 0 || interval.to >= distances.length || interval.to <= interval.from) continue;
    const bucket = interval.kind === matchedKind ? 0 : interval.kind === otherKind ? 1 : 2;
    events[bucket][interval.from] += 1;
    events[bucket][interval.to] -= 1;
  }
  const active = [0, 0, 0];
  let matched = 0;
  let known = 0;
  for (let segment = 0; segment < distances.length - 1; segment += 1) {
    for (let kind = 0; kind < active.length; kind += 1) active[kind] += events[kind][segment];
    const length = distances[segment + 1] - distances[segment];
    if (active[2] || Boolean(active[0]) === Boolean(active[1])) continue;
    known += length;
    if (active[0]) matched += length;
  }
  return share(matched, known, distances.at(-1) ?? 0);
}

function contains(bounds: Bounds, [lng, lat]: Coordinate, marginM = 0): boolean {
  const latMargin = marginM / metersPerDegree;
  const lngMargin = latMargin / Math.max(0.00001, Math.cos(lat * radians));
  return lng >= bounds.west + lngMargin && lng <= bounds.east - lngMargin && lat >= bounds.south + latMargin && lat <= bounds.north - latMargin;
}

function geometryBounds(points: Coordinate[]): Bounds {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const [lng, lat] of points) { west = Math.min(west, lng); east = Math.max(east, lng); south = Math.min(south, lat); north = Math.max(north, lat); }
  return { west, south, east, north };
}

function indexedRing(ring: Coordinate[], budget: { remaining: number }) {
  const bounds = geometryBounds(ring);
  const height = Math.max(1e-9, bounds.north - bounds.south);
  const bands: Array<Array<[Coordinate, Coordinate]>> = Array.from({ length: 16 }, () => []);
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (a[1] === b[1]) continue;
    const low = Math.max(0, Math.min(15, Math.floor((Math.min(a[1], b[1]) - bounds.south) / height * 16)));
    const high = Math.max(0, Math.min(15, Math.floor((Math.max(a[1], b[1]) - bounds.south) / height * 16)));
    budget.remaining -= high - low + 1;
    if (budget.remaining < 0) return null;
    for (let band = low; band <= high; band++) bands[band].push([a, b]);
  }
  return { bounds, height, bands };
}

function ringAt(ring: NonNullable<ReturnType<typeof indexedRing>>, [lng, lat]: Coordinate, budget: { remaining: number }) {
  if (!contains(ring.bounds, [lng, lat])) return false;
  const edges = ring.bands[Math.max(0, Math.min(15, Math.floor((lat - ring.bounds.south) / ring.height * 16)))];
  budget.remaining -= edges.length;
  if (budget.remaining < 0) return false;
  let inside = false;
  for (const [a, b] of edges) {
    if ((a[1] > lat) !== (b[1] > lat) && lng < (b[0] - a[0]) * (lat - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function nearSegment(point: Coordinate, from: Coordinate, to: Coordinate, radiusM: number): boolean {
  const xScale = metersPerDegree * Math.cos(point[1] * radians);
  const ax = (from[0] - point[0]) * xScale;
  const ay = (from[1] - point[1]) * metersPerDegree;
  const bx = (to[0] - point[0]) * xScale;
  const by = (to[1] - point[1]) * metersPerDegree;
  if (Math.min(ax, bx) > radiusM || Math.max(ax, bx) < -radiusM || Math.min(ay, by) > radiusM || Math.max(ay, by) < -radiusM) return false;
  const dx = bx - ax;
  const dy = by - ay;
  const fraction = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
  return (ax + dx * fraction) ** 2 + (ay + dy * fraction) ** 2 <= radiusM ** 2;
}

function waterIndex(lines: Coordinate[][], latitude: number) {
  const xScale = metersPerDegree * Math.max(0.001, Math.cos(latitude * radians));
  const cells = new Map<string, Array<[Coordinate, Coordinate]>>();
  let entries = 0;
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i];
      const minX = Math.floor(Math.min(a[0], b[0]) * xScale / 150);
      const maxX = Math.floor(Math.max(a[0], b[0]) * xScale / 150);
      const minY = Math.floor(Math.min(a[1], b[1]) * metersPerDegree / 150);
      const maxY = Math.floor(Math.max(a[1], b[1]) * metersPerDegree / 150);
      entries += (maxX - minX + 1) * (maxY - minY + 1);
      if (entries > 32_000) return null;
      for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) {
        const key = `${x},${y}`;
        const cell = cells.get(key) ?? [];
        cell.push([a, b]); cells.set(key, cell);
      }
    }
  }
  return { cells, xScale };
}

export function assessCandidate(candidate: RouteCandidate, geography: GeographicContext): CourseAssessment {
  const stats = courseStats([candidate.points]);
  const distances = pathDistances(candidate.points);
  const geometrySize = [...geography.parks, ...geography.water].reduce((sum, polygon) => sum + polygon.rings.reduce((total, ring) => total + ring.length, 0), 0) + geography.waterways.reduce((sum, line) => sum + line.length, 0);
  const status = geometrySize > maxGeometryVertices ? "unavailable" : geography.status;
  const indexBudget = { remaining: 32_000 };
  const parks = status === "unavailable" ? [] : geography.parks.map((polygon) => polygon.rings.map((ring) => indexBudget.remaining < 0 ? null : indexedRing(ring, indexBudget)));
  const water = status === "unavailable" || geography.bounds.south < -85 || geography.bounds.north > 85 ? null : waterIndex([...geography.water.flatMap((polygon) => polygon.rings), ...geography.waterways], (geography.bounds.north + geography.bounds.south) / 2);
  const parkBudget = { remaining: 100_000 };
  let waterWork = 0;
  let parksComplete = parks.every((rings) => rings.every(Boolean)), waterComplete = water !== null;
  let parksMatched = 0;
  let parksKnown = 0;
  let waterMatched = 0;
  let waterKnown = 0;
  // Equal-distance samples prevent densely encoded paths from receiving extra weight.
  const samples = status === "unavailable" ? [] : samplePath(candidate.points, distances, Math.min(600, Math.max(1, Math.ceil(stats.distanceM / 25))));
  const weight = samples.length ? stats.distanceM / samples.length : 0;
  for (const sample of samples) {
    if (!contains(geography.bounds, sample)) continue;
    const park = parksComplete && parks.some((rings) => Boolean(rings[0] && ringAt(rings[0], sample, parkBudget)) && !rings.slice(1).some((ring) => ring && ringAt(ring, sample, parkBudget)));
    if (parkBudget.remaining < 0) parksComplete = false;
    let nearWater = false;
    if (waterComplete && water) {
      const x = Math.floor(sample[0] * water.xScale / 150);
      const y = Math.floor(sample[1] * metersPerDegree / 150);
      for (let dx = -1; dx <= 1 && !nearWater && waterComplete; dx++) for (let dy = -1; dy <= 1 && !nearWater && waterComplete; dy++) {
        for (const [a, b] of water.cells.get(`${x + dx},${y + dy}`) ?? []) {
          if (++waterWork > 100_000) { waterComplete = false; break; }
          if (nearSegment(sample, a, b, 75)) { nearWater = true; break; }
        }
      }
    }
    if (park) parksMatched += weight;
    if (nearWater) waterMatched += weight;
    // A partial response can establish presence, but cannot establish absence.
    if (park || status === "available") parksKnown += weight;
    if (nearWater || (status === "available" && contains(geography.bounds, sample, 75))) waterKnown += weight;
  }
  return {
    version: 1,
    ...stats,
    geographyStatus: status === "available" && (!parksComplete || !waterComplete) ? "partial" : status,
    parks: share(parksComplete ? parksMatched : 0, parksComplete ? parksKnown : 0, stats.distanceM),
    waterfront: share(waterComplete ? waterMatched : 0, waterComplete ? waterKnown : 0, stats.distanceM),
    paved: intervalShare(candidate.surface, distances, "paved", "unpaved"),
    quietEstimate: intervalShare(candidate.waytype, distances, "path", "road"),
  };
}

function duplicateGeometry(a: Coordinate[], b: Coordinate[]): boolean {
  return [false, true].some((reverse) => a.every((point, index) => {
    const other = b[reverse ? b.length - 1 - index : index];
    return nearSegment(point, other, other, 5);
  }));
}

export function rankCandidates(
  candidates: AssessedCandidate[],
  targetM: number,
  preferences: CourseVibe[],
  hills: "any" | "less" | "more",
): RankedCandidates {
  if (!Number.isFinite(targetM) || targetM <= 0) throw new Error("A positive target distance is required.");
  const unique: Array<AssessedCandidate & { samples: Coordinate[]; index: number; error: number }> = [];
  candidates.forEach((item, index) => {
    const samples = samplePath(item.candidate.points, pathDistances(item.candidate.points), 65, true);
    if (samples.length && unique.some((other) => Math.abs(other.assessment.distanceM - item.assessment.distanceM) <= item.assessment.distanceM * 0.005 && duplicateGeometry(samples, other.samples))) return;
    unique.push({ ...item, samples, index, error: Math.abs(item.assessment.distanceM - targetM) / targetM });
  });
  const eligible = unique.filter((item) => item.samples.length && item.error <= 0.3 + 1e-10);
  const preferred = eligible.filter((item) => item.error <= 0.1 + 1e-10);
  const comparison = preferred.length ? preferred : eligible;
  const preferenceDimension: Record<CourseVibe, AssessmentDimension> = { green: "parks", water: "waterfront", paved: "paved", quiet: "quietEstimate" };
  const requested = [...new Set(preferences.map((preference) => preferenceDimension[preference]))];
  if (hills !== "any") requested.push("ascent");
  const usedDimensions = requested.filter((dimension) => {
    if (comparison.length < 2) return false;
    if (dimension === "ascent") return comparison.every((item) => item.assessment.ascentM !== null);
    const coverage = comparison.map((item) => item.assessment[dimension].knownM / item.assessment.distanceM);
    return Math.min(...coverage) + 1e-10 >= 0.8 && Math.max(...coverage) - Math.min(...coverage) <= 0.1 + 1e-10;
  });
  const ignoredDimensions = requested.filter((dimension) => !usedDimensions.includes(dimension));
  const maxAscent = Math.max(1, ...comparison.map((item) => item.assessment.ascentM ?? 0));
  const counts = {
    requestedCount: candidates.length,
    uniqueCount: unique.length,
    comparedCount: eligible.length,
    duplicateCount: candidates.length - unique.length,
    rejectedCount: unique.length - eligible.length,
    usedDimensions,
    ignoredDimensions,
  };
  const ranked = eligible.map((item) => {
    const score = usedDimensions.reduce((sum, dimension) => {
      if (dimension === "ascent") {
        if (item.assessment.ascentM === null) return sum;
        const ascent = Math.min(1, item.assessment.ascentM / maxAscent);
        return sum + (hills === "less" ? 1 - ascent : ascent);
      }
      // Score confirmed distance only. Unknown distance never earns preference credit.
      return sum + item.assessment[dimension].matchedM / item.assessment.distanceM;
    }, 0) / (usedDimensions.length || 1);
    const selection: CourseSelection = { ...counts, distanceError: item.error, distanceBand: item.error <= 0.1 + 1e-10 ? "preferred" : "fallback", score };
    return { candidate: item.candidate, assessment: { ...item.assessment, selection }, index: item.index };
  }).sort((a, b) => {
    const left = a.assessment.selection;
    const right = b.assessment.selection;
    return Number(left.distanceBand === "fallback") - Number(right.distanceBand === "fallback") || right.score - left.score || left.distanceError - right.distanceError || a.index - b.index;
  }).map(({ candidate, assessment }) => ({ candidate, assessment }));
  return { ...counts, ranked };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid course assessment.");
  return value as Record<string, unknown>;
}

function finite(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > maximum) throw new Error("Invalid course assessment number.");
  return value;
}

function parseDimensions(value: unknown): AssessmentDimension[] {
  if (!Array.isArray(value) || value.length > dimensions.length || value.some((item) => !dimensions.includes(item)) || new Set(value).size !== value.length) throw new Error("Invalid assessment dimensions.");
  return [...value];
}

export function parseCourseAssessment(value: unknown): CourseAssessment {
  const input = record(value);
  if (input.version !== 1 || !["available", "partial", "unavailable"].includes(String(input.geographyStatus))) throw new Error("Invalid course assessment version or geography status.");
  const distanceM = finite(input.distanceM);
  const result: CourseAssessment = {
    version: 1,
    distanceM,
    ascentM: input.ascentM === null ? null : finite(input.ascentM),
    geographyStatus: input.geographyStatus as GeographicContext["status"],
    parks: share(0, 0, distanceM),
    waterfront: share(0, 0, distanceM),
    paved: share(0, 0, distanceM),
    quietEstimate: share(0, 0, distanceM),
  };
  for (const key of shareKeys) {
    const metric = record(input[key]);
    const matchedM = finite(metric.matchedM, distanceM);
    const knownM = finite(metric.knownM, distanceM);
    const unknownM = finite(metric.unknownM, distanceM);
    const proportion = metric.share === null ? null : finite(metric.share, 1);
    if (matchedM > knownM || Math.abs(knownM + unknownM - distanceM) > Math.max(1e-6, distanceM * 1e-9) || (knownM === 0 ? proportion !== null : proportion === null || Math.abs(proportion - matchedM / knownM) > 1e-9)) throw new Error("Inconsistent assessment coverage.");
    result[key] = { matchedM, knownM, unknownM, share: proportion };
  }
  if (result.geographyStatus === "unavailable" && (result.parks.knownM > 0 || result.waterfront.knownM > 0)) throw new Error("Unavailable geography cannot have measured coverage.");
  if (input.selection !== undefined) {
    const selection = record(input.selection);
    const counts = Object.fromEntries(["requestedCount", "uniqueCount", "comparedCount", "duplicateCount", "rejectedCount"].map((key) => {
      const count = finite(selection[key]);
      if (!Number.isInteger(count)) throw new Error("Invalid candidate count.");
      return [key, count];
    })) as Pick<CourseSelection, "requestedCount" | "uniqueCount" | "comparedCount" | "duplicateCount" | "rejectedCount">;
    const distanceError = finite(selection.distanceError, 0.3 + 1e-10);
    const expectedBand = distanceError <= 0.1 + 1e-10 ? "preferred" : "fallback";
    const usedDimensions = parseDimensions(selection.usedDimensions);
    const ignoredDimensions = parseDimensions(selection.ignoredDimensions);
    if (counts.requestedCount !== counts.uniqueCount + counts.duplicateCount || counts.uniqueCount !== counts.comparedCount + counts.rejectedCount || counts.comparedCount < 1 || selection.distanceBand !== expectedBand || usedDimensions.some((dimension) => ignoredDimensions.includes(dimension))) throw new Error("Inconsistent candidate comparison.");
    result.selection = { ...counts, distanceError, distanceBand: expectedBand, usedDimensions, ignoredDimensions, score: finite(selection.score, 1) };
  }
  return result;
}

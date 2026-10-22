import { courseStats, parseCourse, type Course, type CoursePoint, type CourseRequest } from "../src/domain/courses";
import { assessCandidate, rankCandidates, type RouteCandidate } from "../src/domain/course-planning";
import { loadCourseGeography } from "./course-geography";

export class OrsError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export function orsProfile(request: CourseRequest) {
  return request.activity === "Ride"
    ? request.vibes.includes("paved") ? "cycling-road" : "cycling-regular"
    : "foot-walking";
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function intervals<K extends string>(value: unknown, length: number, classify: (code: number) => K) {
  const values = record(value).values;
  if (!Array.isArray(values) || values.length > length) return [];
  let end = 0;
  const result: Array<{ from: number; to: number; kind: K }> = [];
  for (const row of values) {
    if (!Array.isArray(row) || row.length !== 3 || !row.every(Number.isInteger) ||
      row[0] < end || row[1] <= row[0] || row[1] >= length) return [];
    result.push({ from: row[0], to: row[1], kind: classify(row[2]) });
    end = row[1];
  }
  return result;
}

export function parseOrsCandidate(value: unknown, start: CourseRequest["start"]): RouteCandidate {
  const features = record(value).features;
  if (!Array.isArray(features) || features.length !== 1)
    throw new OrsError(502, "The routing service returned an invalid route.");
  const geometry = record(record(features[0]).geometry);
  const coordinates = geometry.coordinates;
  if (geometry.type !== "LineString" || !Array.isArray(coordinates) || coordinates.length < 3 || coordinates.length > 50_000)
    throw new OrsError(502, "The routing service returned an invalid route.");
  const points: CoursePoint[] = coordinates.map((coordinate: unknown) => {
    if (!Array.isArray(coordinate) || coordinate.length < 2 || coordinate.length > 3 ||
      !coordinate.every((n) => typeof n === "number" && Number.isFinite(n)) ||
      Math.abs(coordinate[0]) > 180 || Math.abs(coordinate[1]) > 90 ||
      (coordinate.length === 3 && (coordinate[2] < -12_000 || coordinate[2] > 10_000)))
      throw new OrsError(502, "The routing service returned invalid coordinates.");
    return { lng: coordinate[0], lat: coordinate[1], ...(coordinate.length === 3 ? { elevationM: coordinate[2] } : {}) };
  });
  const separation = (a: CoursePoint, b: CoursePoint) => courseStats([[a, b]]).distanceM;
  if (separation(points[0], points.at(-1)!) > 80 || separation(start, points[0]) > 500 ||
    points.some((p, i) => i > 0 && separation(points[i - 1], p) > 1000) || courseStats([points]).distanceM <= 0)
    throw new OrsError(502, "The routing service could not return a connected loop near your start.");
  const extras = record(record(record(features[0]).properties).extras);
  return {
    points,
    surface: intervals(extras.surface, points.length, (code): "paved" | "unpaved" | "unknown" =>
      [1, 3, 4, 5, 14].includes(code) ? "paved" : [2, 8, 9, 10, 11, 12, 13, 15, 16, 17].includes(code) ? "unpaved" : "unknown"),
    waytype: intervals(extras.waytype, points.length, (code): "path" | "road" | "unknown" =>
      [4, 5, 6, 7, 8].includes(code) ? "path" : [1, 2, 3].includes(code) ? "road" : "unknown"),
  };
}

async function readProvider(response: Response) {
  if (!response.body) throw new OrsError(502, "The routing service returned no route.");
  const reader = response.body.getReader();
  let bytes = 0;
  let content = "";
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 4 * 1024 * 1024) {
        await reader.cancel();
        throw new OrsError(502, "The routing service returned too much data. Try a shorter route.");
      }
      content += decoder.decode(value, { stream: true });
    }
    return JSON.parse(content + decoder.decode()) as unknown;
  } finally { reader.releaseLock(); }
}

export async function generateOrsCourse(request: CourseRequest, apiKey: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<Course> {
  const target = request.distance * (request.unit === "mi" ? 1609.344 : 1000);
  if (target > 100_000)
    throw new OrsError(400, "ORS loop generation supports up to 100 km (62.13 mi). Imported GPX routes can be longer.");
  const profile = orsProfile(request);
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(45_000)]);
  const geographyPromise = loadCourseGeography(request.start, target, deadline, fetcher);
  const resultsPromise = Promise.allSettled([0, 1].map(async (variation) => {
    const response = await fetcher(`https://api.heigit.org/openrouteservice/v2/directions/${profile}/geojson`, {
      method: "POST", redirect: "manual",
      headers: { "Content-Type": "application/json", Authorization: apiKey },
      signal: AbortSignal.any([deadline, AbortSignal.timeout(40_000)]),
      body: JSON.stringify({
        coordinates: [[request.start.lng, request.start.lat]], elevation: true, instructions: false,
        extra_info: ["surface", "waytype"],
        options: { avoid_features: ["ferries"], round_trip: { length: target, points: 3, seed: (request.seed + variation * 104729) % 2147483647 } },
      }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      if ([401, 403].includes(response.status)) throw new OrsError(503, "The server's routing key needs attention. GPX import remains available.");
      if (response.status === 429) throw new OrsError(429, "The routing allowance is temporarily exhausted. Try later or import a GPX.");
      throw new OrsError(503, "The routing service could not find a loop here. Try a different distance or start.");
    }
    return parseOrsCandidate(await readProvider(response), request.start);
  }));
  const [results, geography] = await Promise.all([resultsPromise, geographyPromise]);
  if (signal.aborted) throw signal.reason;
  for (const result of results) {
    if (result.status === "rejected") console.warn(JSON.stringify({ event: "ors-candidate-failed", name: result.reason?.name, reason: String(result.reason?.message ?? "unknown").replaceAll(apiKey, "[redacted]").slice(0, 250) }));
  }
  const candidates = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  if (!candidates.length) {
    const failure = results.find((result) => result.status === "rejected" && result.reason instanceof OrsError);
    if (failure?.status === "rejected") throw failure.reason;
    throw new OrsError(503, "Route search timed out or became unavailable. Try a shorter route or another start.");
  }
  const ranked = rankCandidates(candidates.map((candidate) => ({ candidate, assessment: assessCandidate(candidate, geography) })), target, request.vibes, request.hills ?? "any");
  const selected = ranked.ranked[0];
  if (!selected) throw new OrsError(422, "Neither loop was close enough to your target. Try another distance or start.");
  const warnings = ["Mapped features are estimates, not verified access or current conditions. Review your course before heading out."];
  if (candidates.length < 2) warnings.push("Only one of two route requests succeeded. This course could not be compared with a second result.");
  if (ranked.duplicateCount) warnings.push("Both requests found the same loop. No distinct alternative was available.");
  if (selected.assessment.selection?.distanceBand === "fallback") warnings.push(`This loop differs from your target by ${Math.round(Math.abs(selected.assessment.distanceM - target) / target * 100)}%.`);
  if (ranked.ignoredDimensions.length) warnings.push("Some requested preferences lacked comparable data and were excluded from selection. See the route evidence below.");
  const activity = request.activity.toLowerCase();
  return parseCourse({
    id: `course-${crypto.randomUUID()}`, name: `${request.start.name.split(",")[0].slice(0, 170).trim()} ${activity} loop`,
    description: `A ${(selected.assessment.distanceM / 1000).toFixed(1)} km ${activity} loop from ${request.start.name}. Requested preferences: ${request.vibes.join(", ") || "none"}; hills: ${request.hills ?? "any"}.`,
    activity: request.activity, createdAt: new Date().toISOString(),
    source: { kind: "generated", provider: "ors", profile, request },
    segments: [selected.candidate.points], warnings, assessment: selected.assessment,
  });
}

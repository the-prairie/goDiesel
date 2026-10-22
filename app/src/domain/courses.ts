import { XMLParser, XMLValidator } from "fast-xml-parser";

import type { QuestRoute } from "@/domain/route";

export type CourseActivity = "Run" | "Walk" | "Ride";
export type CourseVibe = "quiet" | "green" | "water" | "paved";

export interface CourseRequest {
  start: { lat: number; lng: number; name: string };
  distance: number;
  unit: "km" | "mi";
  activity: CourseActivity;
  vibes: CourseVibe[];
  seed: number;
}

export interface CoursePoint {
  lat: number;
  lng: number;
  elevationM?: number;
  time?: string;
}

export interface Course {
  id: string;
  name: string;
  description: string;
  activity: CourseActivity;
  createdAt: string;
  source:
    | { kind: "gpx"; filename: string }
    | {
        kind: "generated";
        provider: "brouter";
        request: CourseRequest;
        profile: string;
      };
  segments: CoursePoint[][];
  distanceM: number;
  ascentM: number | null;
  warnings: string[];
}

export interface CourseSummary {
  id: string;
  name: string;
  activity: CourseActivity;
  createdAt: string;
  sourceKind: Course["source"]["kind"];
  distanceM: number;
  ascentM: number | null;
  sectionCount: number;
}

export interface CoursePage {
  courses: CourseSummary[];
  cursor?: string;
}

export const COURSE_PAGE_SIZE = 24;
export const COURSE_ID =
  /^course-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function courseSummary(course: Course): CourseSummary {
  return {
    id: course.id,
    name: course.name,
    activity: course.activity,
    createdAt: course.createdAt,
    sourceKind: course.source.kind,
    distanceM: course.distanceM,
    ascentM: course.ascentM,
    sectionCount: course.segments.length,
  };
}

export function parseCourseSummary(value: unknown): CourseSummary {
  const input = object(value, "Course summary");
  const id = text(input.id, "Course ID", 50);
  if (!COURSE_ID.test(id)) throw new Error("Invalid course ID.");
  if (input.sourceKind !== "gpx" && input.sourceKind !== "generated") {
    throw new Error("Invalid course source.");
  }
  const sectionCount = number(
    input.sectionCount,
    "Section count",
    1,
    COURSE_MAX_POINTS,
  );
  if (!Number.isInteger(sectionCount))
    throw new Error("Invalid section count.");
  return {
    id,
    name: text(input.name, "Course name", 200),
    activity: activity(input.activity),
    createdAt: timestamp(input.createdAt, "Creation time"),
    sourceKind: input.sourceKind,
    distanceM: number(
      input.distanceM,
      "Distance",
      Number.MIN_VALUE,
      Number.MAX_SAFE_INTEGER,
    ),
    ascentM:
      input.ascentM === null
        ? null
        : number(input.ascentM, "Ascent", 0, Number.MAX_SAFE_INTEGER),
    sectionCount,
  };
}

export function courseCursor(id: string): string {
  return btoa(`courses-v1:${id}`)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export function parseCourseCursor(value: string): string {
  if (!/^[A-Za-z0-9_-]{72}$/.test(value))
    throw new Error("Invalid course cursor.");
  const decoded = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
  const id = decoded.slice(11);
  if (
    !decoded.startsWith("courses-v1:") ||
    !COURSE_ID.test(id) ||
    courseCursor(id) !== value
  ) {
    throw new Error("Invalid course cursor.");
  }
  return id;
}

export function parseCoursePage(value: unknown): CoursePage {
  const input = object(value, "Course page");
  if (
    !Array.isArray(input.courses) ||
    input.courses.length > COURSE_PAGE_SIZE
  ) {
    throw new Error("Invalid course page.");
  }
  if (input.cursor !== undefined) {
    if (typeof input.cursor !== "string")
      throw new Error("Invalid course cursor.");
    parseCourseCursor(input.cursor);
  }
  return {
    courses: input.courses.map(parseCourseSummary),
    ...(input.cursor !== undefined ? { cursor: input.cursor as string } : {}),
  };
}

export const COURSE_MAX_POINTS = 50_000;
export const COURSE_MAX_GPX_BYTES = 5 * 1024 * 1024;
export const COURSE_MIN_DISTANCE_KM = 1;
export const COURSE_MAX_DISTANCE_KM = 200;

const activities: CourseActivity[] = ["Run", "Walk", "Ride"];
const vibes: CourseVibe[] = ["quiet", "green", "water", "paved"];
const invalidXmlCharacters = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/u;

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, limit: number, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) {
    throw new Error(`${label} must contain text.`);
  }
  if (value.length > limit || invalidXmlCharacters.test(value)) {
    throw new Error(`${label} contains invalid text or exceeds ${limit} characters.`);
  }
  return value.trim();
}

function number(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be a number between ${min} and ${max}.`);
  }
  return value;
}

function activity(value: unknown): CourseActivity {
  if (!activities.includes(value as CourseActivity)) {
    throw new Error("Activity must be Run, Walk, or Ride.");
  }
  return value as CourseActivity;
}

function timestamp(value: unknown, label: string): string {
  const result = text(value, label, 40);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(result);
  if (!match || !Number.isFinite(Date.parse(result))) {
    throw new Error(`${label} must be an ISO timestamp with a timezone.`);
  }
  const [, year, month, day, hour, minute, second, zone] = match;
  const daysInMonth = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  if (
    Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > daysInMonth ||
    Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 ||
    (zone !== "Z" && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59))
  ) {
    throw new Error(`${label} is not a valid timestamp.`);
  }
  return result;
}

export function parseCourseRequest(value: unknown): CourseRequest {
  const input = object(value, "Route request");
  const start = object(input.start, "Start location");
  const unit = input.unit;
  if (unit !== "km" && unit !== "mi") throw new Error("Distance unit must be km or mi.");
  const distance = number(input.distance, "Distance", 0, COURSE_MAX_DISTANCE_KM);
  const distanceKm = distance * (unit === "mi" ? 1.609344 : 1);
  if (distanceKm < COURSE_MIN_DISTANCE_KM || distanceKm > COURSE_MAX_DISTANCE_KM) {
    throw new Error(`Choose a distance between ${COURSE_MIN_DISTANCE_KM} and ${COURSE_MAX_DISTANCE_KM} km, or the equivalent in miles.`);
  }
  if (!Array.isArray(input.vibes) || input.vibes.length > vibes.length ||
      input.vibes.some((vibe) => !vibes.includes(vibe as CourseVibe))) {
    throw new Error("Vibes may only include quiet, green, water, and paved.");
  }
  const seed = number(input.seed, "Variation", 0, 2_147_483_647);
  if (!Number.isInteger(seed)) throw new Error("Variation must be a whole number.");
  return {
    start: {
      lat: number(start.lat, "Start latitude", -90, 90),
      lng: number(start.lng, "Start longitude", -180, 180),
      name: text(start.name, "Start name", 200),
    },
    distance,
    unit,
    activity: activity(input.activity),
    vibes: [...new Set(input.vibes as CourseVibe[])],
    seed,
  };
}

function point(value: unknown): CoursePoint {
  const input = object(value, "Route point");
  return {
    lat: number(input.lat, "Latitude", -90, 90),
    lng: number(input.lng, "Longitude", -180, 180),
    ...(input.elevationM !== undefined
      ? { elevationM: number(input.elevationM, "Elevation", -12_000, 10_000) } : {}),
    ...(input.time !== undefined ? { time: timestamp(input.time, "Point time") } : {}),
  };
}

export function courseStats(segments: CoursePoint[][]): { distanceM: number; ascentM: number | null } {
  let distanceM = 0;
  let ascentM = 0;
  let completeElevation = segments.some((segment) => segment.length > 0);
  for (const segment of segments) {
    for (let index = 0; index < segment.length; index += 1) {
      const current = segment[index];
      if (current.elevationM === undefined) completeElevation = false;
      if (index === 0) continue;
      const previous = segment[index - 1];
      const radians = Math.PI / 180;
      const latDelta = (current.lat - previous.lat) * radians;
      const lngDelta = (current.lng - previous.lng) * radians;
      const a = Math.sin(latDelta / 2) ** 2 + Math.cos(previous.lat * radians) *
        Math.cos(current.lat * radians) * Math.sin(lngDelta / 2) ** 2;
      distanceM += 2 * 6_371_000 * Math.asin(Math.sqrt(Math.min(1, a)));
      if (current.elevationM !== undefined && previous.elevationM !== undefined) {
        ascentM += Math.max(0, current.elevationM - previous.elevationM);
      }
    }
  }
  return { distanceM, ascentM: completeElevation ? ascentM : null };
}

export function parseCourse(value: unknown): Course {
  const input = object(value, "Course");
  const id = text(input.id, "Course ID", 50);
  if (!/^course-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error("Course ID must be course- followed by a UUID.");
  }
  if (!Array.isArray(input.segments) || !input.segments.length) {
    throw new Error("A course must contain route segments.");
  }
  let pointCount = 0;
  const segments = input.segments.map((segment) => {
    if (!Array.isArray(segment) || !segment.length) throw new Error("Route segments must contain points.");
    pointCount += segment.length;
    if (pointCount > COURSE_MAX_POINTS) throw new Error(`A course may contain at most ${COURSE_MAX_POINTS.toLocaleString("en-US")} points.`);
    return segment.map(point);
  });
  const stats = courseStats(segments);
  if (stats.distanceM <= 0) throw new Error("A course must contain a connected path with at least two different points.");
  const sourceInput = object(input.source, "Course source");
  let source: Course["source"];
  if (sourceInput.kind === "gpx") {
    source = { kind: "gpx", filename: text(sourceInput.filename, "GPX filename", 255) };
  } else if (sourceInput.kind === "generated" && sourceInput.provider === "brouter") {
    const profile = text(sourceInput.profile, "Routing profile", 80);
    if (!/^[a-z0-9_-]+$/i.test(profile)) throw new Error("Routing profile contains invalid characters.");
    source = { kind: "generated", provider: "brouter", profile, request: parseCourseRequest(sourceInput.request) };
  } else {
    throw new Error("Course source must be GPX or a generated BRouter route.");
  }
  if (!Array.isArray(input.warnings) || input.warnings.length > 20) {
    throw new Error("Course warnings must be a list of at most 20 messages.");
  }
  const courseActivity = activity(input.activity);
  if (source.kind === "generated" && source.request.activity !== courseActivity) {
    throw new Error("Course activity must match the route request.");
  }
  return {
    id,
    name: text(input.name, "Course name", 200),
    description: text(input.description, "Course description", 4_000, true),
    activity: courseActivity,
    createdAt: timestamp(input.createdAt, "Creation time"),
    source,
    segments,
    ...stats,
    warnings: input.warnings.map((warning) => text(warning, "Warning", 500)),
  };
}

type XmlNode = Record<string, unknown>;

function children(node: XmlNode, name: string): XmlNode[] {
  return Array.isArray(node[name]) ? node[name] as XmlNode[] : [];
}

function childText(nodes: XmlNode[], name: string): string | undefined {
  const node = nodes.find((item) => name in item);
  if (!node) return undefined;
  const content = children(node, name);
  if (content.some((item) => Object.keys(item).some((key) => key !== "#text"))) {
    throw new Error(`GPX ${name} must contain plain text.`);
  }
  return content.map((item) => item["#text"] ?? "").join("").trim();
}

function gpxNumber(value: unknown, label: string): number {
  if (typeof value !== "string" || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())) {
    throw new Error(`GPX ${label} must be a decimal number.`);
  }
  return Number(value);
}

function gpxPoint(node: XmlNode, name: string): CoursePoint {
  const attrs = object(node[":@"], "GPX point coordinates");
  const content = children(node, name);
  const elevation = childText(content, "ele");
  const time = childText(content, "time");
  return point({
    lat: gpxNumber(attrs["@_lat"], "latitude"),
    lng: gpxNumber(attrs["@_lon"], "longitude"),
    ...(elevation !== undefined ? { elevationM: gpxNumber(elevation, "elevation") } : {}),
    ...(time !== undefined ? { time } : {}),
  });
}

function validatedXml(xml: string) {
  if (new TextEncoder().encode(xml).byteLength > COURSE_MAX_GPX_BYTES) {
    throw new Error("GPX files must be no larger than 5 MB.");
  }
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw new Error("GPX files cannot contain DTDs or entity declarations.");
  if (invalidXmlCharacters.test(xml) || XMLValidator.validate(xml) !== true) throw new Error("The GPX file contains malformed XML.");
  const markup = xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->/g, "");
  if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(markup)) throw new Error("The GPX file contains an unsupported entity.");
  for (const entity of markup.matchAll(/&#(x[0-9a-fA-F]+|\d+);/g)) {
    const code = entity[1].startsWith("x") ? parseInt(entity[1].slice(1), 16) : Number(entity[1]);
    if (!(code === 9 || code === 10 || code === 13 ||
      (code >= 32 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) && code !== 0xfffe && code !== 0xffff))) {
      throw new Error("The GPX file contains an invalid character reference.");
    }
  }
  let depth = 0;
  for (const tag of markup.matchAll(/<(?:[^>"']|"[^"]*"|'[^']*')*>/g)) {
    if (tag[0].startsWith("<?") || tag[0].startsWith("<!")) continue;
    if (tag[0].startsWith("</")) depth -= 1;
    else if (!tag[0].endsWith("/>")) depth += 1;
    if (depth > 64) throw new Error("The GPX file is nested too deeply.");
  }
}

export function importCourseGpx(
  xml: string,
  options: { id: string; createdAt: string; filename: string; activity: CourseActivity; name?: string },
): Course {
  validatedXml(xml);
  const document = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: false,
    preserveOrder: true,
    ignorePiTags: true,
    htmlEntities: true,
  }).parse(xml) as XmlNode[];
  const roots = document.filter((node) => !Object.hasOwn(node, "#text"));
  if (roots.length !== 1 || !Object.hasOwn(roots[0], "gpx")) throw new Error("The file must contain a GPX document.");
  const content = children(roots[0], "gpx");
  const segments: CoursePoint[][] = [];
  let pointCount = 0;
  let trackName: string | undefined;
  let trackDescription: string | undefined;
  const append = (nodes: XmlNode[], pointName: string) => {
    const points = nodes.filter((node) => Object.hasOwn(node, pointName));
    pointCount += points.length;
    if (pointCount > COURSE_MAX_POINTS) throw new Error("GPX files may contain at most 50,000 points.");
    if (points.length) segments.push(points.map((node) => gpxPoint(node, pointName)));
  };
  for (const node of content) {
    if (Object.hasOwn(node, "trk")) {
      const track = children(node, "trk");
      trackName ??= childText(track, "name");
      trackDescription ??= childText(track, "desc");
      for (const segment of track.filter((item) => Object.hasOwn(item, "trkseg"))) append(children(segment, "trkseg"), "trkpt");
    } else if (Object.hasOwn(node, "rte")) {
      const route = children(node, "rte");
      trackName ??= childText(route, "name");
      trackDescription ??= childText(route, "desc");
      append(route, "rtept");
    }
  }
  const metadata = children(content.find((node) => "metadata" in node) ?? {}, "metadata");
  const warnings: string[] = [];
  if (segments.length > 1) warnings.push("Separate GPX segments are preserved. Gaps are not connected.");
  if (content.some((node) => Object.hasOwn(node, "rte"))) {
    warnings.push("GPX route waypoints are preserved as supplied. Paths between sparse waypoints have not been routed.");
  }
  if (segments.some((segment) => segment.some((sample) => sample.elevationM === undefined))) {
    warnings.push("Elevation is missing for some or all points. Total ascent is unavailable.");
  }
  return parseCourse({
    ...options,
    name: options.name ?? (childText(metadata, "name") || childText(content, "name") || trackName || options.filename.replace(/\.gpx$/i, "")),
    description: childText(metadata, "desc") ?? childText(content, "desc") ?? trackDescription ?? "",
    source: { kind: "gpx", filename: options.filename },
    segments,
    warnings,
  });
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!);
}

function gpxDecimal(value: number): string {
  const string = String(value);
  if (!string.includes("e")) return string;
  const [coefficient, exponent] = string.split("e");
  const sign = coefficient.startsWith("-") ? "-" : "";
  const unsigned = coefficient.replace("-", "");
  const digits = unsigned.replace(".", "");
  const decimalPosition = (unsigned.indexOf(".") === -1 ? unsigned.length : unsigned.indexOf(".")) + Number(exponent);
  return decimalPosition <= 0
    ? `${sign}0.${"0".repeat(-decimalPosition)}${digits}`
    : `${sign}${digits.slice(0, decimalPosition)}.${digits.slice(decimalPosition)}`;
}

function gpxDocument(name: string, description: string, activityType: string, segments: CoursePoint[][]): string {
  const tracks = segments.map((segment) => `<trkseg>${segment.map((sample) =>
    `<trkpt lat="${gpxDecimal(sample.lat)}" lon="${gpxDecimal(sample.lng)}">${sample.elevationM !== undefined ? `<ele>${gpxDecimal(sample.elevationM)}</ele>` : ""}${sample.time !== undefined ? `<time>${escapeXml(sample.time)}</time>` : ""}</trkpt>`,
  ).join("")}</trkseg>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="goDiesel" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>${escapeXml(name)}</name><desc>${escapeXml(description)}</desc></metadata><trk><name>${escapeXml(name)}</name><type>${escapeXml(activityType)}</type>${tracks}</trk></gpx>`;
}

export function courseGpx(course: Course): string {
  return gpxDocument(course.name, course.description, course.activity, course.segments);
}

export function questRouteGpx(route: QuestRoute): string {
  if (route.route.length < 2 || route.lifecycle === "planned") throw new Error("This route has no recorded geometry to export.");
  const temporal = route.provenance.temporal;
  const startTime = temporal.status === "recorded" && temporal.startTimeUtc ? Date.parse(temporal.startTimeUtc) : NaN;
  const segments: CoursePoint[][] = [[]];
  for (let index = 0; index < route.route.length; index += 1) {
    const sample = route.route[index];
    const previous = route.route[index - 1];
    if (previous && route.provenance.discontinuities.some((gap) =>
      gap.startD === gap.endD
        ? previous.d <= gap.startD && sample.d > gap.endD
        : previous.d < gap.endD && sample.d > gap.startD,
    )) segments.push([]);
    segments.at(-1)!.push({
      lat: sample.lat,
      lng: sample.lng,
      ...(Number.isFinite(startTime) && sample.elapsedS !== undefined
        ? { time: new Date(startTime + sample.elapsedS * 1_000).toISOString() } : {}),
    });
  }
  const description = [
    route.description,
    "Sampled route geometry from goDiesel. Recorded gaps are preserved. Elevation is omitted because its original availability is not retained in this route export.",
  ].filter(Boolean).join("\n\n");
  return gpxDocument(route.name, description, route.type, segments);
}

import {
  normalizeRouteLifecycle,
  type RouteLifecycle,
} from "@/domain/route-lifecycle";

export type RouteActivityType = "Run" | "Ride" | string;
export type RouteGeometryStatus = "ready" | "missing" | "invalid";

export interface RoutePoint {
  lat: number;
  lng: number;
  elev: number;
  d: number;
}

export interface ReplayMetadata {
  replayMode: "earth" | "atlas";
  replayEligible: boolean;
  bestInEarth: boolean;
  geometryStatus: RouteGeometryStatus;
}

export type CurationReviewStatus = "draft" | "reviewed" | "published";

export interface RouteCuration {
  vibe?: string;
  idealUse?: string;
  terrain?: string[];
  difficulty?: string;
  highlights?: string[];
  caveats?: string[];
  seasonality?: string;
  editorialNote?: string;
  reviewStatus: CurationReviewStatus;
}

export interface RouteSummary {
  slug: string;
  activityId: string;
  lifecycle: RouteLifecycle;
  name: string;
  subtitle: string;
  activityName: string;
  region: string;
  date: string;
  distanceKm: number;
  elevationGainM: number;
  type: RouteActivityType;
  description: string;
  completionRule: string;
  difficulty: string;
  theme: string;
  xp: number;
  trace: RoutePoint[];
  centerLat: number;
  centerLng: number;
  replay: ReplayMetadata;
}

export interface QuestRoute extends Omit<RouteSummary, "trace"> {
  route: RoutePoint[];
  midIdx: number;
  curation: RouteCuration;
}

export interface GeneratedQuestRoute {
  slug?: unknown;
  activity_id?: unknown;
  lifecycle?: unknown;
  status?: unknown;
  name?: unknown;
  subtitle?: unknown;
  activity_name?: unknown;
  region?: unknown;
  date?: unknown;
  distance_km?: unknown;
  elevation_gain_m?: unknown;
  type?: unknown;
  description?: unknown;
  completion_rule?: unknown;
  difficulty?: unknown;
  theme?: unknown;
  xp?: unknown;
  trace?: unknown;
  route?: unknown;
  center_lat?: unknown;
  center_lng?: unknown;
  mid_idx?: unknown;
  replay?: unknown;
  curation?: unknown;
}

const curationFields = [
  "vibe",
  "ideal_use",
  "terrain",
  "difficulty",
  "highlights",
  "caveats",
  "seasonality",
  "editorial_note",
] as const;

function optionalCurationText(source: Record<string, unknown>, field: string) {
  const value = source[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`curation.${field} must be a non-empty string`);
  }
  return value.trim();
}

function optionalCurationList(source: Record<string, unknown>, field: string) {
  const value = source[field];
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== "string" || !item.trim())
  ) {
    throw new Error(`curation.${field} must be a list of non-empty strings`);
  }
  return value.map((item) => (item as string).trim());
}

function validatedCuration(value: unknown): RouteCuration {
  if (value === undefined) return { reviewStatus: "draft" };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("curation must be an object");
  }

  const source = value as Record<string, unknown>;
  const reviewStatus = source.review_status ?? "draft";
  if (
    reviewStatus !== "draft" &&
    reviewStatus !== "reviewed" &&
    reviewStatus !== "published"
  ) {
    throw new Error("curation.review_status must be draft, reviewed, or published");
  }

  const curation: RouteCuration = {
    vibe: optionalCurationText(source, "vibe"),
    idealUse: optionalCurationText(source, "ideal_use"),
    terrain: optionalCurationList(source, "terrain"),
    difficulty: optionalCurationText(source, "difficulty"),
    highlights: optionalCurationList(source, "highlights"),
    caveats: optionalCurationList(source, "caveats"),
    seasonality: optionalCurationText(source, "seasonality"),
    editorialNote: optionalCurationText(source, "editorial_note"),
    reviewStatus,
  };

  if (reviewStatus !== "draft") {
    for (const field of curationFields) {
      if (source[field] === undefined) {
        throw new Error(`${reviewStatus} curation is missing ${field}`);
      }
    }
  }

  return Object.fromEntries(
    Object.entries(curation).filter(([, fieldValue]) => fieldValue !== undefined),
  ) as unknown as RouteCuration;
}

function numberValue(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function requiredSlug(input: GeneratedQuestRoute, context: string) {
  const slug = stringValue(input.slug, stringValue(input.activity_id)).trim();
  if (!slug) throw new Error(`${context} is missing slug`);
  return slug;
}

function parsedRoutePoints(value: unknown) {
  if (!Array.isArray(value) || value.length < 2) {
    return { points: [] as RoutePoint[], status: "missing" as const };
  }

  const points: RoutePoint[] = [];
  let previousDistance = -1;
  for (const point of value) {
    const source = Array.isArray(point)
      ? { lat: point[0], lng: point[1], elev: point[2], d: point[3] }
      : point && typeof point === "object"
        ? (point as Record<string, unknown>)
        : null;
    const lat = source ? numberValue(source.lat, Number.NaN) : Number.NaN;
    const lng = source ? numberValue(source.lng, Number.NaN) : Number.NaN;
    const elev = source ? numberValue(source.elev, Number.NaN) : Number.NaN;
    const d = source ? numberValue(source.d, Number.NaN) : Number.NaN;

    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      !Number.isFinite(elev) ||
      !Number.isFinite(d) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180 ||
      d < 0 ||
      d < previousDistance
    ) {
      return { points: [] as RoutePoint[], status: "invalid" as const };
    }
    points.push({ lat, lng, elev, d });
    previousDistance = d;
  }

  return { points, status: "ready" as const };
}

function replayMetadata(
  value: unknown,
  lifecycle: RouteLifecycle,
  geometryStatus: RouteGeometryStatus,
): ReplayMetadata {
  const source =
    value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const bestInEarth = source.best_in_earth === true;
  const replayMode = source.mode === "earth" || bestInEarth ? "earth" : "atlas";
  const replayRequested = source.replay_eligible !== false;

  return {
    replayMode,
    replayEligible:
      lifecycle === "completed" && geometryStatus === "ready" && replayRequested,
    bestInEarth,
    geometryStatus,
  };
}

function commonRouteFields(
  input: GeneratedQuestRoute,
  slug: string,
  geometryStatus: RouteGeometryStatus,
) {
  const lifecycle = normalizeRouteLifecycle(input.lifecycle ?? input.status);

  return {
    slug,
    activityId: stringValue(input.activity_id, slug),
    lifecycle,
    name: stringValue(input.name, "Untitled route"),
    subtitle: stringValue(input.subtitle),
    activityName: stringValue(input.activity_name),
    region: stringValue(input.region, "Unknown region"),
    date: stringValue(input.date),
    distanceKm: numberValue(input.distance_km),
    elevationGainM: numberValue(input.elevation_gain_m),
    type: stringValue(input.type, "Run"),
    description: stringValue(input.description),
    completionRule: stringValue(input.completion_rule),
    difficulty: stringValue(input.difficulty, "Open"),
    theme: stringValue(input.theme, "Quest"),
    xp: numberValue(input.xp),
    centerLat: numberValue(input.center_lat),
    centerLng: numberValue(input.center_lng),
    replay: replayMetadata(input.replay, lifecycle, geometryStatus),
  };
}

function generatedRoute(value: unknown, context: string): GeneratedQuestRoute {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context} must be an object`);
  }
  return value as GeneratedQuestRoute;
}

function requiredStringField(
  input: GeneratedQuestRoute,
  field: keyof GeneratedQuestRoute,
  allowEmpty = true,
) {
  const value = input[field];
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) {
    throw new Error(`${String(field)} must be a string${allowEmpty ? "" : " with content"}`);
  }
  return value;
}

function requiredNumberField(
  input: GeneratedQuestRoute,
  field: keyof GeneratedQuestRoute,
  options: { min?: number; max?: number; integer?: boolean } = {},
) {
  const value = input[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${String(field)} must be a finite number`);
  }
  if (options.min !== undefined && value < options.min) {
    throw new Error(`${String(field)} must be at least ${options.min}`);
  }
  if (options.max !== undefined && value > options.max) {
    throw new Error(`${String(field)} must be at most ${options.max}`);
  }
  if (options.integer && !Number.isInteger(value)) {
    throw new Error(`${String(field)} must be an integer`);
  }
  return value;
}

function validatedReplayMetadata(
  value: unknown,
  lifecycle: RouteLifecycle,
  geometryStatus: RouteGeometryStatus,
): ReplayMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("replay must be an object");
  }
  const source = value as Record<string, unknown>;
  if (source.mode !== "atlas" && source.mode !== "earth") {
    throw new Error("replay.mode must be atlas or earth");
  }
  if (typeof source.replay_eligible !== "boolean") {
    throw new Error("replay.replay_eligible must be a boolean");
  }
  if (typeof source.best_in_earth !== "boolean") {
    throw new Error("replay.best_in_earth must be a boolean");
  }
  if (source.geometry_status !== "ready" && source.geometry_status !== "missing") {
    throw new Error("replay.geometry_status must be ready or missing");
  }
  if (source.best_in_earth && source.mode !== "earth") {
    throw new Error("best_in_earth replay must use earth mode");
  }

  return {
    replayMode: source.mode,
    replayEligible:
      lifecycle === "completed" && geometryStatus === "ready" && source.replay_eligible,
    bestInEarth: source.best_in_earth,
    geometryStatus,
  };
}

function validatedDetailFields(
  input: GeneratedQuestRoute,
  slug: string,
  geometryStatus: RouteGeometryStatus,
) {
  const lifecycleValue = input.lifecycle;
  if (
    lifecycleValue !== "completed" &&
    lifecycleValue !== "planned" &&
    lifecycleValue !== "discovered"
  ) {
    throw new Error("lifecycle must be completed, planned, or discovered");
  }
  const lifecycle = lifecycleValue as RouteLifecycle;

  return {
    slug,
    activityId: requiredStringField(input, "activity_id", false),
    lifecycle,
    name: requiredStringField(input, "name", false),
    subtitle: requiredStringField(input, "subtitle"),
    activityName: requiredStringField(input, "activity_name"),
    region: requiredStringField(input, "region", false),
    date: requiredStringField(input, "date"),
    distanceKm: requiredNumberField(input, "distance_km", { min: 0 }),
    elevationGainM: requiredNumberField(input, "elevation_gain_m", { min: 0 }),
    type: requiredStringField(input, "type", false),
    description: requiredStringField(input, "description"),
    completionRule: requiredStringField(input, "completion_rule"),
    difficulty: requiredStringField(input, "difficulty", false),
    theme: requiredStringField(input, "theme", false),
    xp: requiredNumberField(input, "xp", { min: 0 }),
    centerLat: requiredNumberField(input, "center_lat", { min: -90, max: 90 }),
    centerLng: requiredNumberField(input, "center_lng", { min: -180, max: 180 }),
    replay: validatedReplayMetadata(input.replay, lifecycle, geometryStatus),
    curation: validatedCuration(input.curation),
  };
}

export function parseRouteSummary(value: unknown): RouteSummary {
  const input = generatedRoute(value, "Route summary");
  const slug = requiredSlug(input, "Route summary");
  const parsedTrace = parsedRoutePoints(input.trace);
  const trace = parsedTrace.points;
  const geometryStatus =
    input.replay &&
    typeof input.replay === "object" &&
    (input.replay as Record<string, unknown>).geometry_status === "missing"
      ? "missing"
      : parsedTrace.status;

  return {
    ...commonRouteFields(input, slug, geometryStatus),
    trace,
    centerLat: numberValue(input.center_lat, trace[0]?.lat ?? 0),
    centerLng: numberValue(input.center_lng, trace[0]?.lng ?? 0),
  };
}

export function parseRouteDetail(value: unknown): QuestRoute {
  const input = generatedRoute(value, "Route detail");
  const slug = requiredSlug(input, "Route detail");
  const parsedRoute = parsedRoutePoints(input.route);
  const route = parsedRoute.points;
  const geometryStatus = parsedRoute.status;
  const midIdx = requiredNumberField(input, "mid_idx", { min: 0, integer: true });
  if (geometryStatus === "ready" && midIdx >= route.length) {
    throw new Error("mid_idx must reference a route point");
  }

  return {
    ...validatedDetailFields(input, slug, geometryStatus),
    route,
    midIdx,
  };
}

export function hasRouteGeometry(route: QuestRoute) {
  return route.replay.geometryStatus === "ready" && route.route.length > 1;
}

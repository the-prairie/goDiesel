import {
  normalizeRouteLifecycle,
  type RouteLifecycle,
} from "@/domain/route-lifecycle";

export type RouteActivityType = "Run" | "Ride" | string;
export type RouteGeometryStatus = "ready" | "missing";

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

function routePoints(value: unknown): RoutePoint[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((point) => {
      if (Array.isArray(point)) {
        const lat = numberValue(point[0], Number.NaN);
        const lng = numberValue(point[1], Number.NaN);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return {
          lat,
          lng,
          elev: numberValue(point[2]),
          d: numberValue(point[3]),
        };
      }
      if (!point || typeof point !== "object") return null;
      const source = point as Record<string, unknown>;
      const lat = numberValue(source.lat, Number.NaN);
      const lng = numberValue(source.lng, Number.NaN);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

      return {
        lat,
        lng,
        elev: numberValue(source.elev),
        d: numberValue(source.d),
      };
    })
    .filter((point): point is RoutePoint => Boolean(point));
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

export function parseRouteSummary(value: unknown): RouteSummary {
  const input = generatedRoute(value, "Route summary");
  const slug = requiredSlug(input, "Route summary");
  const trace = routePoints(input.trace);
  const geometryStatus =
    input.replay &&
    typeof input.replay === "object" &&
    (input.replay as Record<string, unknown>).geometry_status === "missing"
      ? "missing"
      : "ready";

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
  const route = routePoints(input.route);
  const geometryStatus = route.length > 1 ? "ready" : "missing";

  return {
    ...commonRouteFields(input, slug, geometryStatus),
    route,
    centerLat: numberValue(input.center_lat, route[0]?.lat ?? 0),
    centerLng: numberValue(input.center_lng, route[0]?.lng ?? 0),
    midIdx: numberValue(input.mid_idx, Math.floor(route.length / 2)),
  };
}

export function hasRouteGeometry(route: QuestRoute) {
  return route.replay.geometryStatus === "ready" && route.route.length > 1;
}

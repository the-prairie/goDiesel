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

export interface QuestRoute {
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
  route: RoutePoint[];
  centerLat: number;
  centerLng: number;
  midIdx: number;
  replay: ReplayMetadata;
  raw: GeneratedQuestRoute;
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

function routePoints(value: unknown): RoutePoint[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((point) => {
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

export function hasRouteGeometry(route: QuestRoute) {
  return route.replay.geometryStatus === "ready" && route.route.length > 1;
}

export function toQuestRoute(input: GeneratedQuestRoute): QuestRoute {
  const route = routePoints(input.route);
  const slug = stringValue(input.slug, stringValue(input.activity_id));
  const lifecycle = normalizeRouteLifecycle(input.lifecycle ?? input.status);
  const bestInEarth = Boolean(
    input.replay &&
      typeof input.replay === "object" &&
      "best_in_earth" in input.replay &&
      (input.replay as Record<string, unknown>).best_in_earth,
  );

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
    route,
    centerLat: numberValue(input.center_lat, route[0]?.lat ?? 0),
    centerLng: numberValue(input.center_lng, route[0]?.lng ?? 0),
    midIdx: numberValue(input.mid_idx, Math.floor(route.length / 2)),
    replay: {
      replayMode: bestInEarth ? "earth" : "atlas",
      replayEligible: lifecycle === "completed" && route.length > 1,
      bestInEarth,
      geometryStatus: route.length > 1 ? "ready" : "missing",
    },
    raw: input,
  };
}

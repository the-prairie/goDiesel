import { useSyncExternalStore } from "react";

import type {
  DiscoveryCandidate,
  FinderIntent,
  PlannedRoute,
} from "@/domain/planning";
import { placesOverlap } from "@/domain/place-match";

export const PLANNED_ROUTE_STORAGE_KEY = "godiesel.planned-routes.v1";
const STORE_VERSION = 1 as const;
const EMPTY_ROUTES: PlannedRoute[] = [];

interface PlannedRouteEnvelope {
  version: typeof STORE_VERSION;
  routes: PlannedRoute[];
}

let cachedRaw: string | null | undefined;
let cachedRoutes = EMPTY_ROUTES;
const listeners = new Set<() => void>();

export function encodePlannedRouteStore(routes: PlannedRoute[]) {
  return JSON.stringify({ version: STORE_VERSION, routes } satisfies PlannedRouteEnvelope);
}

export function decodePlannedRouteStore(raw: string | null): PlannedRoute[] {
  if (!raw) return EMPTY_ROUTES;

  try {
    const parsed = JSON.parse(raw) as Partial<PlannedRouteEnvelope>;
    if (parsed.version !== STORE_VERSION || !Array.isArray(parsed.routes)) return EMPTY_ROUTES;
    return parsed.routes.filter(isPersistedPlannedRoute);
  } catch {
    return EMPTY_ROUTES;
  }
}

export function getPlannedRoutes() {
  if (typeof window === "undefined") return EMPTY_ROUTES;
  const raw = safeRead();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedRoutes = decodePlannedRouteStore(raw);
  }
  return cachedRoutes;
}

export function savePlannedRoute(
  candidate: DiscoveryCandidate,
  intent: FinderIntent,
  now = new Date(),
) {
  const proposedSlug = `planned-${candidate.id}`;
  const existing = getPlannedRoutes().find(
    (route) =>
      route.slug === proposedSlug ||
      route.planning.candidateId === candidate.id ||
      route.planning.sourceRouteSlug === candidate.sourceRouteSlug,
  );
  if (existing) return { created: false, persisted: true, route: existing };

  const createdAt = now.toISOString();
  const route: PlannedRoute = {
    ...candidate.route,
    slug: `planned-${candidate.id}`,
    activityId: `planned:${candidate.id}`,
    lifecycle: "planned",
    date: createdAt.slice(0, 10),
    completionRule: "Complete this route and import the resulting activity.",
    xp: 0,
    replay: {
      ...candidate.route.replay,
      replayEligible: false,
      bestInEarth: false,
    },
    planning: {
      candidateId: candidate.id,
      sourceRouteSlug: candidate.sourceRouteSlug,
      sourceLabel: candidate.sourceLabel,
      sourceSnapshot: candidate.route,
      createdAt,
      storeVersion: STORE_VERSION,
      intent,
    },
  };
  const persisted = writeRoutes([...getPlannedRoutes(), route], true);
  return { created: persisted, persisted, route };
}

export function updatePlannedRouteIntent(
  slug: string,
  intent: FinderIntent,
  source?: DiscoveryCandidate,
  now = new Date(),
) {
  const routes = getPlannedRoutes();
  const index = routes.findIndex((route) => route.slug === slug);
  if (index < 0) return undefined;
  const current = routes[index];
  const intentIdentityChanged =
    intent.place.trim() !== current.planning.intent.place.trim() ||
    intent.activity !== current.planning.intent.activity;
  const sourceIdentityChanged = Boolean(source && (
    source.id !== current.planning.candidateId ||
    source.sourceRouteSlug !== current.planning.sourceRouteSlug
  ));
  if (intentIdentityChanged && !source) return undefined;
  if (source && !sourceMatchesIntent(source, intent)) return undefined;
  if (sourceIdentityChanged && source && routes.some((route, routeIndex) =>
    routeIndex !== index && (
      route.slug === `planned-${source.id}` ||
      route.planning.candidateId === source.id ||
      route.planning.sourceRouteSlug === source.sourceRouteSlug
    )
  )) return undefined;
  const reboundAt = sourceIdentityChanged ? now.toISOString() : current.planning.createdAt;

  const route: PlannedRoute = {
    ...(source?.route ?? current),
    slug: sourceIdentityChanged && source ? `planned-${source.id}` : current.slug,
    activityId: sourceIdentityChanged && source ? `planned:${source.id}` : current.activityId,
    lifecycle: "planned",
    date: sourceIdentityChanged ? reboundAt.slice(0, 10) : current.date,
    completionRule: current.completionRule,
    xp: 0,
    replay: {
      ...(source?.route.replay ?? current.replay),
      replayEligible: false,
      bestInEarth: false,
    },
    planning: {
      ...current.planning,
      ...(source ? {
        candidateId: source.id,
        sourceRouteSlug: source.sourceRouteSlug,
        sourceLabel: source.sourceLabel,
        sourceSnapshot: source.route,
      } : {}),
      createdAt: reboundAt,
      intent,
    },
  };
  const persisted = writeRoutes(
    routes.map((item, itemIndex) => itemIndex === index ? route : item),
    true,
  );
  if (!persisted) return undefined;
  return route;
}

export function removePlannedRoute(slug: string) {
  const routes = getPlannedRoutes();
  const remaining = routes.filter((route) => route.slug !== slug);
  if (remaining.length === routes.length) return false;
  return writeRoutes(remaining, true);
}

export function subscribePlannedRoutes(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined") {
    window.addEventListener("storage", handleStorage);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("storage", handleStorage);
    }
  };
}

export function usePlannedRoutes() {
  return useSyncExternalStore(subscribePlannedRoutes, getPlannedRoutes, () => EMPTY_ROUTES);
}

function writeRoutes(routes: PlannedRoute[], requirePersistence = false) {
  const raw = encodePlannedRouteStore(routes);
  let persisted = true;
  try {
    window.localStorage.setItem(PLANNED_ROUTE_STORAGE_KEY, raw);
  } catch {
    persisted = false;
  }
  if (requirePersistence && !persisted) return false;
  cachedRaw = raw;
  cachedRoutes = routes;
  listeners.forEach((listener) => listener());
  return persisted;
}

function safeRead() {
  try {
    return window.localStorage.getItem(PLANNED_ROUTE_STORAGE_KEY);
  } catch {
    return cachedRaw ?? null;
  }
}

function handleStorage(event: StorageEvent) {
  if (event.key !== PLANNED_ROUTE_STORAGE_KEY) return;
  cachedRaw = undefined;
  listeners.forEach((listener) => listener());
}

function isPersistedPlannedRoute(value: unknown): value is PlannedRoute {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const route = value as Partial<PlannedRoute>;
  return (
    route.lifecycle === "planned" &&
    typeof route.slug === "string" &&
    typeof route.activityId === "string" &&
    typeof route.name === "string" &&
    typeof route.subtitle === "string" &&
    typeof route.activityName === "string" &&
    typeof route.region === "string" &&
    typeof route.date === "string" &&
    finiteNumber(route.distanceKm) &&
    finiteNumber(route.elevationGainM) &&
    typeof route.type === "string" &&
    typeof route.description === "string" &&
    typeof route.completionRule === "string" &&
    typeof route.difficulty === "string" &&
    typeof route.theme === "string" &&
    finiteNumber(route.xp) &&
    finiteNumber(route.centerLat) &&
    finiteNumber(route.centerLng) &&
    Array.isArray(route.trace) && route.trace.every(isPersistedRoutePoint) &&
    route.replay?.replayEligible === false &&
    typeof route.replay.bestInEarth === "boolean" &&
    ["ready", "missing", "invalid"].includes(route.replay.geometryStatus) &&
    ["earth", "atlas"].includes(route.replay.replayMode) &&
    typeof route.guide?.reviewStatus === "string" &&
    ["draft", "reviewed", "published"].includes(route.guide.reviewStatus) &&
    route.planning?.storeVersion === STORE_VERSION &&
    typeof route.planning.candidateId === "string" &&
    typeof route.planning.sourceRouteSlug === "string" &&
    route.planning.sourceLabel === "Owner-curated from recorded GPX" &&
    isPersistedFinderIntent(route.planning.intent) &&
    (route.planning.sourceSnapshot === undefined || (
      isPersistedRouteSnapshot(route.planning.sourceSnapshot) &&
      route.planning.sourceSnapshot.slug === route.planning.sourceRouteSlug &&
      routeMatchesIntent(route.planning.sourceSnapshot, route.planning.intent)
    )) &&
    validDateTime(route.planning.createdAt)
  );
}

function isPersistedFinderIntent(value: unknown): value is FinderIntent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const intent = value as Partial<FinderIntent>;
  return (
    typeof intent.place === "string" &&
    (intent.activity === "Run" || intent.activity === "Ride") &&
    finiteNumber(intent.distanceKm) && intent.distanceKm > 0 &&
    ["any", "road", "trail", "mixed", "mountain"].includes(intent.terrain ?? "") &&
    typeof intent.vibe === "string"
  );
}

function isPersistedRoutePoint(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const point = value as { lat?: unknown; lng?: unknown; elev?: unknown; d?: unknown };
  return finiteNumber(point.lat) && finiteNumber(point.lng) &&
    finiteNumber(point.elev) && finiteNumber(point.d);
}

function isPersistedRouteSnapshot(value: unknown): value is DiscoveryCandidate["route"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const route = value as Partial<DiscoveryCandidate["route"]>;
  return (
    route.lifecycle === "completed" &&
    typeof route.slug === "string" &&
    typeof route.activityId === "string" &&
    typeof route.name === "string" &&
    typeof route.subtitle === "string" &&
    typeof route.activityName === "string" &&
    typeof route.region === "string" &&
    typeof route.date === "string" &&
    finiteNumber(route.distanceKm) &&
    finiteNumber(route.elevationGainM) &&
    (route.type === "Run" || route.type === "Ride") &&
    typeof route.description === "string" &&
    typeof route.completionRule === "string" &&
    typeof route.difficulty === "string" &&
    typeof route.theme === "string" &&
    finiteNumber(route.xp) &&
    finiteNumber(route.centerLat) &&
    finiteNumber(route.centerLng) &&
    Array.isArray(route.trace) && route.trace.every(isPersistedRoutePoint) &&
    typeof route.replay?.replayEligible === "boolean" &&
    typeof route.replay.bestInEarth === "boolean" &&
    ["ready", "missing", "invalid"].includes(route.replay.geometryStatus) &&
    ["earth", "atlas"].includes(route.replay.replayMode) &&
    typeof route.guide?.reviewStatus === "string" &&
    ["draft", "reviewed", "published"].includes(route.guide.reviewStatus)
  );
}

function sourceMatchesIntent(source: DiscoveryCandidate, intent: FinderIntent) {
  return routeMatchesIntent(source.route, intent);
}

function routeMatchesIntent(
  route: DiscoveryCandidate["route"],
  intent: FinderIntent,
) {
  return (
    route.type === intent.activity &&
    placesOverlap(route.region, intent.place)
  );
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validDateTime(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

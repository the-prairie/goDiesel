import { useSyncExternalStore } from "react";

import type {
  DiscoveryCandidate,
  FinderIntent,
  PlannedRoute,
} from "@/domain/planning";

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
    if (!parsed.routes.every(isPersistedPlannedRoute)) return EMPTY_ROUTES;
    return parsed.routes;
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
  const existing = getPlannedRoutes().find(
    (route) => route.planning.candidateId === candidate.id,
  );
  if (existing) return { created: false, route: existing };

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
      createdAt,
      storeVersion: STORE_VERSION,
      intent,
    },
  };
  writeRoutes([...getPlannedRoutes(), route]);
  return { created: true, route };
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

function writeRoutes(routes: PlannedRoute[]) {
  const raw = encodePlannedRouteStore(routes);
  try {
    window.localStorage.setItem(PLANNED_ROUTE_STORAGE_KEY, raw);
  } catch {
    // Keep planning usable for this tab when storage is unavailable.
  }
  cachedRaw = raw;
  cachedRoutes = routes;
  listeners.forEach((listener) => listener());
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
    typeof route.region === "string" &&
    typeof route.distanceKm === "number" &&
    Array.isArray(route.trace) &&
    route.replay?.replayEligible === false &&
    route.planning?.storeVersion === STORE_VERSION &&
    typeof route.planning.candidateId === "string" &&
    typeof route.planning.sourceRouteSlug === "string"
  );
}

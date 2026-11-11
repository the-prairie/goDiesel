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

/**
 * The tab's view of planned routes.
 *
 * - `unread`: storage must be read before the routes are trusted.
 * - `persisted`: the routes match the last raw value read from or written to storage.
 * - `memory-only`: storage rejected a write, so the routes exist only in this tab.
 *   Reads and storage events do not replace them until a later write succeeds.
 */
export type PlannedRouteCache =
  | { mode: "unread"; routes: PlannedRoute[] }
  | { mode: "persisted"; raw: string | null; routes: PlannedRoute[] }
  | { mode: "memory-only"; raw: string; routes: PlannedRoute[] };

export type PlannedRouteCacheEvent =
  | { type: "storageRead"; raw: string | null }
  | { type: "storageChanged" }
  | { type: "writeAccepted"; raw: string; routes: PlannedRoute[] }
  | { type: "writeRejected"; raw: string; routes: PlannedRoute[] };

export type PlannedRouteStorageStatus = "persisted" | "memory-only";

export const initialPlannedRouteCache: PlannedRouteCache = {
  mode: "unread",
  routes: EMPTY_ROUTES,
};

export function reducePlannedRouteCache(
  state: PlannedRouteCache,
  event: PlannedRouteCacheEvent,
): PlannedRouteCache {
  switch (event.type) {
    case "storageRead":
      if (state.mode === "memory-only") return state;
      if (state.mode === "persisted" && state.raw === event.raw) return state;
      return { mode: "persisted", raw: event.raw, routes: decodePlannedRouteStore(event.raw) };
    case "storageChanged":
      return state.mode === "persisted" ? { mode: "unread", routes: state.routes } : state;
    case "writeAccepted":
      return { mode: "persisted", raw: event.raw, routes: event.routes };
    case "writeRejected":
      return { mode: "memory-only", raw: event.raw, routes: event.routes };
  }
}

export function plannedRouteStorageStatus(state: PlannedRouteCache): PlannedRouteStorageStatus {
  return state.mode === "memory-only" ? "memory-only" : "persisted";
}

let cache: PlannedRouteCache = initialPlannedRouteCache;
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
  if (cache.mode !== "memory-only") {
    cache = reducePlannedRouteCache(cache, { type: "storageRead", raw: safeRead() });
  }
  return cache.routes;
}

export function getPlannedRouteStorageStatus(): PlannedRouteStorageStatus {
  return plannedRouteStorageStatus(cache);
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

/** Whether saved plans reach storage, or live only in this tab after a rejected write. */
export function usePlannedRouteStorageStatus() {
  return useSyncExternalStore(
    subscribePlannedRoutes,
    getPlannedRouteStorageStatus,
    (): PlannedRouteStorageStatus => "persisted",
  );
}

function writeRoutes(routes: PlannedRoute[]) {
  const raw = encodePlannedRouteStore(routes);
  try {
    window.localStorage.setItem(PLANNED_ROUTE_STORAGE_KEY, raw);
    cache = reducePlannedRouteCache(cache, { type: "writeAccepted", raw, routes });
  } catch {
    // Keep planning usable for this tab when storage is unavailable.
    cache = reducePlannedRouteCache(cache, { type: "writeRejected", raw, routes });
  }
  listeners.forEach((listener) => listener());
}

function safeRead() {
  try {
    return window.localStorage.getItem(PLANNED_ROUTE_STORAGE_KEY);
  } catch {
    return cache.mode === "persisted" ? cache.raw : null;
  }
}

function handleStorage(event: StorageEvent) {
  if (event.key !== PLANNED_ROUTE_STORAGE_KEY) return;
  const next = reducePlannedRouteCache(cache, { type: "storageChanged" });
  if (next === cache) return;
  cache = next;
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

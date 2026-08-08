import type { RouteSummary } from "@/domain/route";

export type FinderActivity = "Run" | "Ride";
export type FinderTerrain = "any" | "road" | "trail" | "mixed" | "mountain";

export interface FinderIntent {
  place: string;
  activity: FinderActivity;
  distanceKm: number;
  terrain: FinderTerrain;
  vibe: string;
}

export interface DiscoveryCandidate {
  id: string;
  sourceRouteSlug: string;
  sourceLabel: "Owner-curated from recorded GPX";
  terrain: Exclude<FinderTerrain, "any">[];
  vibes: string[];
  route: RouteSummary;
}

export interface DiscoveryResult {
  status: "matches" | "unsupported";
  candidates: DiscoveryCandidate[];
  message: string;
}

export interface RouteDiscoveryProvider {
  search(intent: FinderIntent): DiscoveryResult;
}

export interface PlannedRouteMetadata {
  candidateId: string;
  sourceRouteSlug: string;
  sourceLabel: DiscoveryCandidate["sourceLabel"];
  createdAt: string;
  storeVersion: 1;
  intent: FinderIntent;
}

export interface PlannedRoute extends RouteSummary {
  lifecycle: "planned";
  planning: PlannedRouteMetadata;
}

export function isPlannedRoute(route: RouteSummary): route is PlannedRoute {
  return route.lifecycle === "planned" && "planning" in route;
}

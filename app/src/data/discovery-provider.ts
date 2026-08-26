import { discoveredRoutes } from "@/data/routes";
import type { RouteSummary } from "@/domain/route";
import type {
  DiscoveryCandidate,
  FinderIntent,
  FinderTerrain,
  RouteDiscoveryProvider,
} from "@/domain/planning";

const unsupportedMessage =
  "No owner-curated route matches this search yet. Finder only returns source-backed discovered routes.";

export function createCuratedRouteDiscoveryProvider(
  availableRoutes: RouteSummary[],
): RouteDiscoveryProvider {
  const candidates = availableRoutes
    .filter((route) => route.lifecycle === "discovered")
    .map(discoveryCandidate);
  return {
    search(intent) {
      const matches = candidates.filter((candidate) =>
        candidateMatchesIntent(candidate, intent),
      );
      return matches.length > 0
        ? {
            status: "matches",
            candidates: matches,
            message: `${matches.length} owner-curated ${matches.length === 1 ? "route" : "routes"} found.`,
          }
        : { status: "unsupported", candidates: [], message: unsupportedMessage };
    },
  };
}

export const curatedRouteDiscoveryProvider =
  createCuratedRouteDiscoveryProvider(discoveredRoutes);

function discoveryCandidate(route: RouteSummary): DiscoveryCandidate {
  const terrain = route.discovery?.terrain.length
    ? route.discovery.terrain
    : inferTerrain(route);
  const vibes = unique([
    ...(route.discovery?.vibes ?? []),
    route.guide.vibe ?? "",
    route.theme,
  ]);
  return {
    id: `owner-route-${route.slug}`,
    sourceRouteSlug: route.slug,
    sourceLabel: "Owner-curated route source",
    terrain,
    vibes,
    route,
  };
}

function inferTerrain(route: RouteSummary): Exclude<FinderTerrain, "any">[] {
  const source = normalized(
    `${route.theme} ${route.difficulty} ${route.guide.vibe ?? ""}`,
  );
  const values: Exclude<FinderTerrain, "any">[] = [];
  for (const terrain of ["road", "trail", "mixed", "mountain"] as const) {
    if (source.includes(terrain)) values.push(terrain);
  }
  return values.length ? values : ["mixed"];
}

function candidateMatchesIntent(candidate: DiscoveryCandidate, intent: FinderIntent) {
  const place = normalized(intent.place);
  const candidatePlace = normalized(candidate.route.region);
  if (place && !candidatePlace.includes(place) && !place.includes(candidatePlace)) return false;
  if (candidate.route.type !== intent.activity) return false;
  if (intent.distanceKm > 0) {
    const toleranceKm = Math.max(3, intent.distanceKm * 0.3);
    if (Math.abs(candidate.route.distanceKm - intent.distanceKm) > toleranceKm) return false;
  }
  if (intent.terrain !== "any" && !candidate.terrain.includes(intent.terrain)) return false;
  const vibe = normalized(intent.vibe);
  if (vibe) {
    const source = normalized(candidate.vibes.join(" "));
    if (!vibe.split(" ").filter(Boolean).every((term) => source.includes(term))) return false;
  }
  return true;
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalized(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

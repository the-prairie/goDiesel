import type {
  DiscoveryCandidate,
  DiscoveryResult,
  FinderIntent,
} from "@/domain/planning";
import type { RouteSummary } from "@/domain/route";

export interface SourceBackedRouteCorpus {
  routes: RouteSummary[];
  sourceSlugs: string[];
}

export interface SourceBackedCandidateCorpus {
  candidates: DiscoveryCandidate[];
  sourceCandidateIds: string[];
}

export function createSourceBackedRouteCorpus(
  sourceRoutes: readonly RouteSummary[],
  count: number,
): SourceBackedRouteCorpus {
  if (sourceRoutes.length === 0) {
    throw new Error("Runtime corpus requires at least one source-backed route");
  }

  const routes: RouteSummary[] = [];
  const sourceSlugs: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const source = sourceRoutes[index % sourceRoutes.length];
    const replica = Math.floor(index / sourceRoutes.length);
    routes.push({
      ...source,
      slug: `perf-${source.slug}-${replica.toString().padStart(3, "0")}`,
      activityId: `perf-${source.activityId}-${replica.toString().padStart(3, "0")}`,
      replay: { ...source.replay },
      guide: { ...source.guide },
      // Geometry and measured/editorial attributes remain source-backed. Only
      // fixture identity changes to exercise production cardinality.
      trace: source.trace,
    });
    sourceSlugs.push(source.slug);
  }

  return { routes, sourceSlugs };
}

export function createSourceBackedCandidateCorpus(
  sourceCandidates: readonly DiscoveryCandidate[],
  count: number,
): SourceBackedCandidateCorpus {
  if (sourceCandidates.length === 0) {
    throw new Error("Runtime corpus requires at least one Finder candidate");
  }

  const sourceRoutes = sourceCandidates.map((candidate) => candidate.route);
  const routeCorpus = createSourceBackedRouteCorpus(sourceRoutes, count);
  const candidates = routeCorpus.routes.map((route, index) => {
    const source = sourceCandidates[index % sourceCandidates.length];
    const replica = Math.floor(index / sourceCandidates.length);
    return {
      ...source,
      id: `perf-${source.id}-${replica.toString().padStart(4, "0")}`,
      sourceRouteSlug: route.slug,
      terrain: [...source.terrain],
      vibes: [...source.vibes],
      route,
    } satisfies DiscoveryCandidate;
  });

  return {
    candidates,
    sourceCandidateIds: Array.from(
      { length: count },
      (_, index) => sourceCandidates[index % sourceCandidates.length].id,
    ),
  };
}

export function findRouteBySlugInCorpus(
  corpus: readonly RouteSummary[],
  slug: string,
) {
  return corpus.find((route) => route.slug === slug);
}

export function searchDiscoveryCandidates(
  candidates: readonly DiscoveryCandidate[],
  intent: FinderIntent,
): DiscoveryResult {
  const matches = candidates.filter((candidate) =>
    candidateMatchesIntent(candidate, intent),
  );

  return matches.length > 0
    ? {
        status: "matches",
        candidates: matches,
        message: `${matches.length} owner-curated ${matches.length === 1 ? "route" : "routes"} found.`,
      }
    : {
        status: "unsupported",
        candidates: [],
        message:
          "No owner-curated route matches this search yet. Finder only returns recorded or imported GPX candidates.",
      };
}

function candidateMatchesIntent(
  candidate: DiscoveryCandidate,
  intent: FinderIntent,
) {
  const place = normalized(intent.place);
  const candidatePlace = normalized(candidate.route.region);
  if (place && !candidatePlace.includes(place) && !place.includes(candidatePlace)) {
    return false;
  }
  if (candidate.route.type !== intent.activity) return false;

  if (intent.distanceKm > 0) {
    const toleranceKm = Math.max(3, intent.distanceKm * 0.3);
    if (Math.abs(candidate.route.distanceKm - intent.distanceKm) > toleranceKm) {
      return false;
    }
  }

  if (intent.terrain !== "any" && !candidate.terrain.includes(intent.terrain)) {
    return false;
  }

  const vibe = normalized(intent.vibe);
  if (vibe) {
    const source = normalized(
      [
        ...candidate.vibes,
        candidate.route.theme,
        candidate.route.guide.vibe ?? "",
      ].join(" "),
    );
    const requestedTerms = vibe.split(" ").filter(Boolean);
    if (!requestedTerms.every((term) => source.includes(term))) return false;
  }

  return true;
}

function normalized(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

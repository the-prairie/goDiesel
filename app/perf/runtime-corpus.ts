import type {
  DiscoveryCandidate,
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
      // Coordinate values remain source-backed while every replica owns its
      // array and points, matching independent production route geometry.
      trace: source.trace.map((point) => ({ ...point })),
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

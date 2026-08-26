import { findRouteBySlug } from "@/data/routes";
import type {
  DiscoveryCandidate,
  FinderIntent,
  RouteDiscoveryProvider,
} from "@/domain/planning";

const candidateDefinitions = [
  {
    slug: "17654151284",
    terrain: ["mixed", "mountain"],
    vibes: ["exploratory", "climbing", "big day", "city to hills"],
  },
  {
    slug: "13358070690",
    terrain: ["trail", "mixed"],
    vibes: ["wild", "mountain", "big day", "river valley"],
  },
  {
    slug: "14130772463",
    terrain: ["trail", "mountain"],
    vibes: ["coastal", "playful", "trail", "short adventure"],
  },
  {
    slug: "5650407638",
    terrain: ["road", "mixed"],
    vibes: ["touring", "farm roads", "long ride", "big day"],
  },
] as const;

export const curatedDiscoveryCandidates: DiscoveryCandidate[] = candidateDefinitions.map(
  (definition) => {
    const route = findRouteBySlug(definition.slug);
    if (!route) {
      throw new Error(`Curated Finder candidate ${definition.slug} is missing`);
    }

    return {
      id: `owner-route-${route.slug}`,
      sourceRouteSlug: route.slug,
      sourceLabel: "Owner-curated from recorded GPX",
      terrain: [...definition.terrain],
      vibes: [...definition.vibes],
      route,
    };
  },
);

const unsupportedMessage =
  "No owner-curated route matches this search yet. Finder only returns recorded or imported GPX candidates.";

export function createRouteDiscoveryProvider(
  sourceCandidates: readonly DiscoveryCandidate[],
): RouteDiscoveryProvider {
  return {
    search(intent) {
      const candidates = sourceCandidates.filter((candidate) =>
        candidateMatchesIntent(candidate, intent),
      );

      return candidates.length > 0
        ? {
            status: "matches",
            candidates,
            message: `${candidates.length} owner-curated ${candidates.length === 1 ? "route" : "routes"} found.`,
          }
        : { status: "unsupported", candidates: [], message: unsupportedMessage };
    },
  };
}

export const curatedRouteDiscoveryProvider = createRouteDiscoveryProvider(
  curatedDiscoveryCandidates,
);

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

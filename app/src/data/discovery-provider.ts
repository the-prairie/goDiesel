import { rankCollection, type SearchDocument } from "@/domain/search/ranking";
import { routes } from "@/data/routes";
import type {
  DiscoveryResult,
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

export const curatedDiscoveryCandidates: DiscoveryCandidate[] = routes.filter(r => r.lifecycle !== "planned").map(route => {
  const definition = candidateDefinitions.find(d => d.slug === route.slug);
  return { id: `owner-route-${route.slug}`, sourceRouteSlug: route.slug,
    sourceLabel: "Owner-curated from recorded GPX", terrain: definition ? [...definition.terrain] : [],
    vibes: definition ? [...definition.vibes] : [], route };
});

export function searchCollection(intent: FinderIntent, documents: SearchDocument[] = [], vector?: number[]): DiscoveryResult {
  const candidates = rankCollection(curatedDiscoveryCandidates, intent, documents, vector);
  return { status: candidates.length ? "matches" : "unsupported", candidates,
    message: candidates.length ? `${candidates.length} matches from your collection.` : "No collection routes match these filters. Try a wider distance or explore new routes." };
}
export const curatedRouteDiscoveryProvider: RouteDiscoveryProvider = { search: searchCollection };

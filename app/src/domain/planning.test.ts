import { describe, expect, it } from "vitest";

import { createCuratedRouteDiscoveryProvider } from "@/data/discovery-provider";
import type { RouteSummary } from "@/domain/route";
import type { FinderIntent } from "@/domain/planning";

function intent(overrides: Partial<FinderIntent> = {}): FinderIntent {
  return {
    place: "Kyoto",
    activity: "Run",
    distanceKm: 21,
    terrain: "mixed",
    vibe: "exploratory climbing",
    ...overrides,
  };
}

describe("curatedRouteDiscoveryProvider", () => {
  const provider = createCuratedRouteDiscoveryProvider([{
    slug: "route-discovered",
    lifecycle: "discovered",
    region: "Kyoto",
    type: "Run",
    distanceKm: 21,
    theme: "exploratory climbing",
    trace: [
      { lat: 35, lng: 135, elev: 10, d: 0 },
      { lat: 35.05, lng: 135.05, elev: 15, d: 10_500 },
      { lat: 35.1, lng: 135.1, elev: 20, d: 21_000 },
    ],
    guide: { reviewStatus: "draft" },
    discovery: { terrain: ["mixed"], vibes: ["exploratory climbing"] },
  } as RouteSummary]);

  it("returns only explicit candidates backed by recorded routes", () => {
    const result = provider.search(intent());

    expect(result.status).toBe("matches");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      id: "owner-route-route-discovered",
      sourceRouteSlug: "route-discovered",
      sourceLabel: "Owner-curated route source",
    });
    expect(result.candidates[0].route.trace.length).toBeGreaterThan(2);
  });

  it("does not invent a route when the curated source has no match", () => {
    const result = provider.search(
      intent({ place: "Patagonia", terrain: "trail", vibe: "remote" }),
    );

    expect(result).toEqual({
      status: "unsupported",
      candidates: [],
      message:
        "No owner-curated route matches this search yet. Finder only returns source-backed discovered routes.",
    });
  });
});

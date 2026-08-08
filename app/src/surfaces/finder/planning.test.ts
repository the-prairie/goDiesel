import { describe, expect, it } from "vitest";

import { curatedRouteDiscoveryProvider } from "@/data/discovery-provider";
import type { FinderIntent } from "@/surfaces/finder/planning";

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
  it("returns only explicit candidates backed by recorded routes", () => {
    const result = curatedRouteDiscoveryProvider.search(intent());

    expect(result.status).toBe("matches");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      id: "owner-route-17654151284",
      sourceRouteSlug: "17654151284",
      sourceLabel: "Owner-curated from recorded GPX",
    });
    expect(result.candidates[0].route.trace.length).toBeGreaterThan(2);
  });

  it("does not invent a route when the curated source has no match", () => {
    const result = curatedRouteDiscoveryProvider.search(
      intent({ place: "Patagonia", terrain: "trail", vibe: "remote" }),
    );

    expect(result).toEqual({
      status: "unsupported",
      candidates: [],
      message:
        "No owner-curated route matches this search yet. Finder only returns recorded or imported GPX candidates.",
    });
  });
});

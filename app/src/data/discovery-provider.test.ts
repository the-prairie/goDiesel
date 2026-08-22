import { describe, expect, it } from "vitest";

import type { RouteSummary } from "@/domain/route";
import { createCuratedRouteDiscoveryProvider } from "@/data/discovery-provider";

const baseRoute = {
  type: "Run",
  distanceKm: 20,
  region: "Calgary, AB",
  theme: "Open",
  guide: { reviewStatus: "draft" },
  discovery: { terrain: ["trail"], vibes: ["ridge"] },
} as RouteSummary;

describe("curated route discovery provider", () => {
  it("derives candidates from discovered lifecycle instead of hardcoded slugs", () => {
    const provider = createCuratedRouteDiscoveryProvider([
      { ...baseRoute, slug: "route-private", lifecycle: "discovered" },
      { ...baseRoute, slug: "completed-memory", lifecycle: "completed" },
    ]);

    const result = provider.search({
      activity: "Run",
      distanceKm: 20,
      place: "Calgary",
      terrain: "trail",
      vibe: "ridge",
    });

    expect(result.candidates.map((candidate) => candidate.sourceRouteSlug)).toEqual([
      "route-private",
    ]);
  });
});

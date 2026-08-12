import { describe, expect, it } from "vitest";

import { buildRouteRegions } from "@/data/route-regions";
import type { RouteSummary } from "@/domain/route";
import {
  atlasLensFromSearchParams,
  deriveTerrainReading,
  latestRecordedRegion,
  shouldOpenLatestRegion,
} from "@/surfaces/atlas/atlas-regional-view";

function route(overrides: Partial<RouteSummary>): RouteSummary {
  return {
    slug: "route",
    activityId: "activity",
    lifecycle: "completed",
    name: "Route",
    subtitle: "",
    activityName: "Activity",
    region: "Older place",
    date: "2025-01-01",
    distanceKm: 12,
    elevationGainM: 420,
    type: "Run",
    description: "",
    completionRule: "Complete the route.",
    difficulty: "",
    theme: "",
    xp: 0,
    trace: [
      { lat: 1, lng: 1, elev: 100, d: 0 },
      { lat: 2, lng: 2, elev: 350, d: 12_000 },
    ],
    centerLat: 1.5,
    centerLng: 1.5,
    replay: {
      replayMode: "atlas",
      replayEligible: true,
      bestInEarth: false,
      geometryStatus: "ready",
    },
    guide: { reviewStatus: "draft" },
    ...overrides,
  };
}

describe("regional Atlas entry", () => {
  it("chooses the region containing the latest recorded route", () => {
    const regions = buildRouteRegions([
      route({}),
      route({ slug: "new", region: "Recent place", date: "2025-08-10" }),
    ]);

    expect(latestRecordedRegion(regions)?.name).toBe("Recent place");
  });

  it("only auto-opens a region for a clean entry URL", () => {
    expect(shouldOpenLatestRegion(new URLSearchParams())).toBe(true);
    expect(shouldOpenLatestRegion(new URLSearchParams("view=world"))).toBe(false);
    expect(shouldOpenLatestRegion(new URLSearchParams("activity=rides"))).toBe(false);
    expect(shouldOpenLatestRegion(new URLSearchParams("q=tokyo"))).toBe(false);
  });

  it("keeps the terrain lens explicit and derives only recorded elevation facts", () => {
    const region = buildRouteRegions([route({})])[0];

    expect(atlasLensFromSearchParams(new URLSearchParams())).toBe("routes");
    expect(atlasLensFromSearchParams(new URLSearchParams("region=Place&lens=terrain"))).toBe(
      "terrain",
    );
    expect(atlasLensFromSearchParams(new URLSearchParams("lens=terrain"))).toBe("routes");
    expect(deriveTerrainReading(region)).toEqual({
      highPointM: 350,
      reliefM: 250,
      recordedClimbM: 420,
      sampleCount: 2,
    });
  });
});

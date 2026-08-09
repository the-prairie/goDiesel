import { describe, expect, it } from "vitest";

import {
  DEFAULT_ROUTE_FILTERS,
  filterRoutes,
  type RouteFilters,
} from "@/surfaces/routes/route-filters";
import type { RouteSummary } from "@/domain/route";

type TestRoute = RouteSummary;

function route(overrides: Partial<TestRoute> = {}): TestRoute {
  return {
    slug: "river-loop",
    activityId: "activity-1",
    lifecycle: "completed",
    name: "River Loop",
    subtitle: "An easy evening circuit",
    activityName: "Tuesday Social Run",
    region: "Calgary",
    date: "2026-07-12",
    distanceKm: 8,
    elevationGainM: 120,
    type: "Run",
    description: "Flat paths beside the Bow River.",
    completionRule: "Complete the route.",
    difficulty: "Easy",
    theme: "Cruise",
    xp: 80,
    trace: [],
    centerLat: 51.05,
    centerLng: -114.07,
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

function filters(overrides: Partial<RouteFilters> = {}): RouteFilters {
  return { ...DEFAULT_ROUTE_FILTERS, ...overrides };
}

describe("filterRoutes", () => {
  it("returns all routes when every filter is at its default", () => {
    const routes = [route(), route({ slug: "second-route", name: "Second route" })];

    expect(filterRoutes(routes, DEFAULT_ROUTE_FILTERS)).toEqual(routes);
  });

  it.each([
    ["name", { name: "Hidden Switchbacks" }],
    ["region", { region: "Vancouver Island" }],
    ["subtitle", { subtitle: "Coastal headwind practice" }],
    ["activity name", { activityName: "Lunch Break Ride" }],
    ["description", { description: "Passes an abandoned rail trestle" }],
    ["theme", { theme: "Big Day" }],
  ])("searches route %s case-insensitively", (_field, overrides) => {
    const matchingRoute = route({ slug: "matching-route", ...overrides });
    const routes = [route({ slug: "other-route" }), matchingRoute];
    const query = Object.values(overrides)[0].toUpperCase();

    expect(filterRoutes(routes, filters({ query }))).toEqual([matchingRoute]);
  });

  it("searches the reviewed guide vibe when one is present", () => {
    const reviewedRoute = route({
      slug: "reviewed-route",
      guide: {
        vibe: "Quiet lanes opening into a sustained climb",
        reviewStatus: "reviewed",
      },
    });

    expect(
      filterRoutes(
        [route({ slug: "other-route" }), reviewedRoute],
        filters({ query: "SUSTAINED CLIMB" }),
      ),
    ).toEqual([reviewedRoute]);
  });

  it("requires every selected exact and range filter to match", () => {
    const matchingRoute = route({
      slug: "matching-route",
      lifecycle: "planned",
      name: "Highwood Gravel",
      activityName: "Highwood recon",
      region: "Kananaskis",
      distanceKm: 32,
      elevationGainM: 900,
      type: "Ride",
      theme: "Quest",
    });
    const routes = [
      matchingRoute,
      route({ ...matchingRoute, slug: "wrong-lifecycle", lifecycle: "completed" }),
      route({ ...matchingRoute, slug: "wrong-activity", type: "Run" }),
      route({ ...matchingRoute, slug: "wrong-region", region: "Calgary" }),
      route({ ...matchingRoute, slug: "wrong-distance", distanceKm: 52 }),
      route({ ...matchingRoute, slug: "wrong-climb", elevationGainM: 600 }),
      route({ ...matchingRoute, slug: "wrong-vibe", theme: "Cruise" }),
    ];

    expect(
      filterRoutes(routes, {
        query: "HIGHWOOD",
        lifecycle: "planned",
        activity: "Ride",
        region: "Kananaskis",
        distance: "20-50",
        climb: "750-plus",
        vibe: "Quest",
      }),
    ).toEqual([matchingRoute]);
  });

  it.each([
    ["under-10", [9.99]],
    ["10-20", [10, 19.99]],
    ["20-50", [20, 49.99]],
    ["50-plus", [50]],
  ] satisfies Array<[RouteFilters["distance"], number[]]>)(
    "uses non-overlapping %s distance boundaries",
    (distance, expectedDistances) => {
      const distances = [9.99, 10, 19.99, 20, 49.99, 50];
      const routes = distances.map((distanceKm) =>
        route({ slug: `distance-${distanceKm}`, distanceKm }),
      );

      expect(filterRoutes(routes, filters({ distance })).map(({ distanceKm }) => distanceKm)).toEqual(
        expectedDistances,
      );
    },
  );

  it.each([
    ["under-250", [249.99]],
    ["250-750", [250, 749.99]],
    ["750-plus", [750]],
  ] satisfies Array<[RouteFilters["climb"], number[]]>)(
    "uses non-overlapping %s climb boundaries",
    (climb, expectedClimbs) => {
      const climbs = [249.99, 250, 749.99, 750];
      const routes = climbs.map((elevationGainM) =>
        route({ slug: `climb-${elevationGainM}`, elevationGainM }),
      );

      expect(
        filterRoutes(routes, filters({ climb })).map(({ elevationGainM }) => elevationGainM),
      ).toEqual(expectedClimbs);
    },
  );

  it("returns no routes when nothing satisfies the filters", () => {
    expect(
      filterRoutes(
        [route(), route({ slug: "planned-route", lifecycle: "planned" })],
        filters({ lifecycle: "discovered", query: "missing" }),
      ),
    ).toEqual([]);
  });
});

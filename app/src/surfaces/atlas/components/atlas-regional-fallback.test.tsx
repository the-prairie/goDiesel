import { describe, expect, it } from "vitest";

import {
  projectedRegionalRoutePaths,
  regionalFitBounds,
  regionalMapPadding,
  regionalRouteCollection,
  type RegionalRouteBounds,
  unwrapLongitudeAroundCenter,
} from "@/surfaces/atlas/components/atlas-regional-fallback";
import type { RouteRegion } from "@/data/route-regions";
import type { RouteSummary } from "@/domain/route";

function route(overrides: Partial<RouteSummary> = {}): RouteSummary {
  return {
    slug: "date-line-run",
    activityId: "activity-1",
    lifecycle: "completed",
    name: "Date Line Run",
    subtitle: "",
    activityName: "Recorded run",
    region: "Pacific",
    date: "2026-07-20",
    distanceKm: 8,
    elevationGainM: 120,
    type: "Run",
    description: "",
    completionRule: "Complete the route.",
    difficulty: "Moderate",
    theme: "Cruise",
    xp: 80,
    trace: [
      { lat: 10, lng: 179, elev: 5, d: 0 },
      { lat: 10.2, lng: -179, elev: 8, d: 8_000 },
    ],
    centerLat: 10.1,
    centerLng: 180,
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

function region(
  routes: RouteSummary[],
  bounds: RegionalRouteBounds = {
    west: 170,
    east: -170,
    south: 8,
    north: 12,
    centerLng: 180,
    spanLng: 20,
  },
) {
  return {
    name: "Pacific",
    routes,
    totalKm: 8,
    totalClimbM: 120,
    centerLat: 10,
    centerLng: 180,
    bounds,
  } as RouteRegion & { bounds: RegionalRouteBounds };
}

describe("AtlasRegionalFallback geography", () => {
  it("unwraps antimeridian coordinates around the region center", () => {
    expect(unwrapLongitudeAroundCenter(179, 180)).toBe(179);
    expect(unwrapLongitudeAroundCenter(-179, 180)).toBe(181);
    expect(unwrapLongitudeAroundCenter(179, -180)).toBe(-181);
  });

  it("renders every valid recorded trace and omits invalid geometry", () => {
    const second = route({
      slug: "second-route",
      name: "Second Route",
      trace: [
        { lat: 9, lng: 178, elev: 2, d: 0 },
        { lat: 9.5, lng: -178, elev: 4, d: 4_000 },
      ],
    });
    const missing = route({
      slug: "missing-route",
      trace: [],
      replay: {
        replayMode: "atlas",
        replayEligible: false,
        bestInEarth: false,
        geometryStatus: "missing",
      },
    });
    const invalid = route({
      slug: "invalid-route",
      trace: [
        { lat: 10, lng: 179, elev: 2, d: 0 },
        { lat: 91, lng: -179, elev: 4, d: 4_000 },
      ],
    });

    const collection = regionalRouteCollection(
      region([route(), second, missing, invalid]),
    );

    expect(collection.features.map(({ properties }) => properties.slug)).toEqual([
      "date-line-run",
      "second-route",
    ]);
    expect(collection.features[0].geometry.coordinates).toEqual([
      [179, 10],
      [181, 10.2],
    ]);
    expect(collection.features[1].geometry.coordinates.at(-1)).toEqual([
      182,
      9.5,
    ]);
  });

  it("uses the recorded regional bounds to frame an antimeridian span", () => {
    expect(regionalFitBounds(region([route()]))).toEqual([
      [170, 8],
      [190, 12],
    ]);
  });

  it("projects recorded route geometry into a visible overlay path", () => {
    const collection = regionalRouteCollection(region([route()]));

    expect(
      projectedRegionalRoutePaths(collection, ([lng, lat]) => ({
        x: lng - 170,
        y: lat - 8,
      })),
    ).toEqual(["M9.0,2.0 L11.0,2.2"]);
  });

  it("reserves responsive safe space for heading and route surfaces", () => {
    expect(regionalMapPadding(1_440, 900)).toEqual({
      top: 96,
      right: 420,
      bottom: 220,
      left: 260,
    });
    expect(regionalMapPadding(390, 844)).toEqual({
      top: 170,
      right: 20,
      bottom: 280,
      left: 20,
    });
  });
});

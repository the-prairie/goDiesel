import { describe, expect, it } from "vitest";

import { buildRouteRegions } from "@/data/route-regions";
import type { RoutePoint, RouteSummary } from "@/domain/route";

function point(lat: number, lng: number): RoutePoint {
  return { lat, lng, elev: 0, d: 0 };
}

function route(overrides: Partial<RouteSummary> = {}): RouteSummary {
  return {
    slug: "first-route",
    activityId: "activity-1",
    lifecycle: "completed",
    name: "First Route",
    subtitle: "",
    activityName: "First activity",
    region: "Dateline",
    date: "2026-07-21",
    distanceKm: 10,
    elevationGainM: 100,
    type: "Run",
    description: "",
    completionRule: "Complete the route.",
    difficulty: "Easy",
    theme: "Cruise",
    xp: 100,
    trace: [point(10, 179)],
    centerLat: 70,
    centerLng: 20,
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

describe("buildRouteRegions", () => {
  it("retains region aggregates and uses geometry bounds for its center", () => {
    const regions = buildRouteRegions([
      route(),
      route({
        slug: "second-route",
        activityId: "activity-2",
        distanceKm: 15,
        elevationGainM: 250,
        trace: [point(14, -177)],
        centerLat: -70,
        centerLng: -20,
      }),
    ]);

    expect(regions).toEqual([
      expect.objectContaining({
        name: "Dateline",
        totalKm: 25,
        totalClimbM: 350,
        centerLat: 12,
        centerLng: -179,
        bounds: {
          south: 10,
          north: 14,
          west: 179,
          east: 183,
          centerLat: 12,
          centerLng: -179,
          longitudeSpan: 4,
          crossesAntimeridian: true,
        },
      }),
    ]);
    expect(regions[0].routes).toHaveLength(2);
  });

  it("keeps a geometry-less region with unavailable bounds", () => {
    const regions = buildRouteRegions([
      route({
        trace: [],
        replay: {
          replayMode: "atlas",
          replayEligible: false,
          bestInEarth: false,
          geometryStatus: "missing",
        },
      }),
    ]);

    expect(regions[0]).toMatchObject({
      bounds: null,
      centerLat: 0,
      centerLng: 0,
    });
  });

  it("reads shared source geometry once across identity replicas", () => {
    let indexedReads = 0;
    const sourceTrace = [
      point(10, 179),
      point(11, -179),
      point(12, -178),
      point(13, -177),
    ];
    const observedTrace = new Proxy(sourceTrace, {
      get(target, property, receiver) {
        if (typeof property === "string" && /^\d+$/.test(property)) {
          indexedReads += 1;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const replicas = Array.from({ length: 100 }, (_, index) =>
      route({
        slug: `replica-${index}`,
        activityId: `activity-${index}`,
        trace: observedTrace,
      }),
    );

    const regions = buildRouteRegions(replicas);

    expect(regions[0].routes).toHaveLength(100);
    expect(regions[0].bounds).toMatchObject({
      south: 10,
      north: 13,
      west: 179,
      east: 183,
    });
    expect(indexedReads).toBeLessThanOrEqual(sourceTrace.length + 1);
  });
});

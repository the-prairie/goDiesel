import { describe, expect, it } from "vitest";

import { deriveGeographicBounds } from "@/domain/geometry/geographic-bounds";
import type { RoutePoint, RouteSummary } from "@/domain/routes";

function point(lat: number, lng: number): RoutePoint {
  return { lat, lng, elev: 0, d: 0 };
}

function route(
  trace: RoutePoint[],
  geometryStatus: RouteSummary["replay"]["geometryStatus"] = "ready",
): RouteSummary {
  return {
    slug: "test-route",
    activityId: "activity-1",
    lifecycle: "completed",
    name: "Test Route",
    subtitle: "",
    activityName: "Test activity",
    region: "Test Region",
    date: "2026-07-21",
    distanceKm: 10,
    elevationGainM: 100,
    type: "Run",
    description: "",
    completionRule: "Complete the route.",
    difficulty: "Easy",
    theme: "Cruise",
    xp: 100,
    trace,
    centerLat: 0,
    centerLng: 0,
    replay: {
      replayMode: "atlas",
      replayEligible: true,
      bestInEarth: false,
      geometryStatus,
    },
    guide: { reviewStatus: "draft" },
  };
}

describe("deriveGeographicBounds", () => {
  it("derives ordinary bounds and their center from ready route geometry", () => {
    const bounds = deriveGeographicBounds([
      route([point(50, -124), point(52, -120), point(51, -122)]),
    ]);

    expect(bounds).toEqual({
      south: 50,
      north: 52,
      west: -124,
      east: -120,
      centerLat: 51,
      centerLng: -122,
      longitudeSpan: 4,
      crossesAntimeridian: false,
    });
  });

  it("uses the minimal circular longitude arc across the antimeridian", () => {
    const bounds = deriveGeographicBounds([
      route([point(-4, 178), point(6, -178), point(2, 179)]),
    ]);

    expect(bounds).toEqual({
      south: -4,
      north: 6,
      west: 178,
      east: 182,
      centerLat: 1,
      centerLng: -180,
      longitudeSpan: 4,
      crossesAntimeridian: true,
    });
  });

  it("ignores non-ready routes and invalid points", () => {
    const bounds = deriveGeographicBounds([
      route([point(40, 10)], "invalid"),
      route([point(95, 15), point(45, Number.NaN), point(42, 12)]),
    ]);

    expect(bounds).toEqual({
      south: 42,
      north: 42,
      west: 12,
      east: 12,
      centerLat: 42,
      centerLng: 12,
      longitudeSpan: 0,
      crossesAntimeridian: false,
    });
  });

  it("returns null when no valid ready geometry exists", () => {
    expect(deriveGeographicBounds([])).toBeNull();
    expect(
      deriveGeographicBounds([
        route([], "missing"),
        route([point(Number.POSITIVE_INFINITY, 10)]),
      ]),
    ).toBeNull();
  });
});

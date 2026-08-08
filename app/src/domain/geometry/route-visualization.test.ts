import { describe, expect, it } from "vitest";

import type { RoutePoint } from "@/domain/routes";
import {
  projectRouteGeometry,
  sampleElevationProfile,
} from "@/domain/geometry/route-visualization";

function point(index: number, overrides: Partial<RoutePoint> = {}): RoutePoint {
  return {
    lat: index / 1_000,
    lng: index / 1_000,
    elev: 100,
    d: index,
    ...overrides,
  };
}

describe("route visualization", () => {
  it("preserves short elevation extrema while reducing profile points", () => {
    const points = Array.from({ length: 1_000 }, (_, index) => point(index));
    points[501] = point(501, { elev: 1_200 });
    points[502] = point(502, { elev: -80 });

    const sampled = sampleElevationProfile(points, 240);

    expect(sampled.length).toBeLessThanOrEqual(240);
    expect(sampled.map(({ elev }) => elev)).toContain(1_200);
    expect(sampled.map(({ elev }) => elev)).toContain(-80);
  });

  it("scales longitude by latitude for geographically faithful route shapes", () => {
    const projected = projectRouteGeometry([
      point(0, { lat: 60, lng: -115 }),
      point(1, { lat: 60, lng: -114 }),
      point(2, { lat: 61, lng: -114 }),
    ]);
    const width = Math.max(...projected.map(({ x }) => x)) - Math.min(...projected.map(({ x }) => x));
    const height = Math.max(...projected.map(({ y }) => y)) - Math.min(...projected.map(({ y }) => y));

    expect(width / height).toBeCloseTo(0.49, 1);
  });

  it("unwraps routes that cross the antimeridian", () => {
    const projected = projectRouteGeometry([
      point(0, { lat: 10, lng: 179.9 }),
      point(1, { lat: 10.1, lng: -179.9 }),
    ]);
    const width = Math.abs(projected[1].x - projected[0].x);

    expect(width).toBeLessThan(0.3);
  });
});

import { describe, expect, it } from "vitest";

import { ROUTE_LIFT_M, routeOnGround } from "@/labs/sketch/sketch-route-ground";

describe("routeOnGround", () => {
  const line: [number, number][] = [
    [135.7737, 34.9948],
    [135.7699, 34.9955],
    [135.7692, 34.9978],
  ];

  it("lays her route on the ground, just above it, in the units of the tile it starts in", () => {
    const { key, segments } = routeOnGround([line], 14, 4096);
    // 135.7737° E, 34.9948° N at zoom 14.
    expect(key).toBe("14/14371/6489");
    expect(segments.length).toBe(2 * 6);
    for (let i = 2; i < segments.length; i += 3) expect(segments[i]).toBeCloseTo(ROUTE_LIFT_M, 5);
  });

  it("joins one point to the next: each segment ends where the next begins", () => {
    const { segments } = routeOnGround([line], 14, 4096);
    expect([segments[3], segments[4]]).toEqual([segments[6], segments[7]]);
  });

  it("keeps a route that leaves its first tile in the same units, past the tile's edge", () => {
    const far: [number, number][] = [
      [135.7737, 34.9948],
      [135.8, 34.9948],
    ];
    const { segments } = routeOnGround([far], 14, 4096);
    expect(segments[3]).toBeGreaterThan(4096);
  });

  it("makes nothing from no routes", () => {
    expect(routeOnGround([], 14, 4096).segments).toHaveLength(0);
  });
});

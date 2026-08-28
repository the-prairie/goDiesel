import { describe, expect, it } from "vitest";

import type { QuestRoute, RoutePoint } from "@/domain/route";
import { routePathPose } from "@/domain/geometry/route-path";

describe("route path pose", () => {
  it("preserves boundary, duplicate-distance, interior, and clamped poses", () => {
    const route = {
      distanceKm: 0.02,
      route: [
        { lat: 0, lng: 179, elev: 10, d: 0 },
        { lat: 10, lng: -179, elev: 20, d: 10 },
        { lat: 20, lng: -178, elev: 30, d: 10 },
        { lat: 30, lng: -177, elev: 40, d: 20 },
      ],
    } as QuestRoute;

    expect(routePathPose(route, -5)).toMatchObject({
      lat: 0,
      lng: 179,
      elev: 10,
      progressM: 0,
      progressRatio: 0,
    });
    expect(routePathPose(route, 10)).toEqual({
      lat: 10,
      lng: -179,
      elev: 20,
      bearingDeg: 0,
      progressM: 10,
      progressRatio: 0.5,
    });
    expect(routePathPose(route, 15)).toMatchObject({
      lat: 25,
      lng: -177.5,
      elev: 35,
      progressM: 15,
      progressRatio: 0.75,
    });
    expect(routePathPose(route, 25)).toMatchObject({
      lat: 30,
      lng: -177,
      elev: 40,
      progressM: 20,
      progressRatio: 1,
    });
  });

  it("resolves a late pose with logarithmic route-point reads", () => {
    const points = Array.from({ length: 50_000 }, (_, index) => ({
      lat: 0,
      lng: index / 1_000,
      elev: index,
      d: index,
    }));
    let indexedReads = 0;
    const observedPoints = new Proxy(points, {
      get(target, property, receiver) {
        if (typeof property === "string" && /^\d+$/.test(property)) {
          indexedReads += 1;
        }
        return Reflect.get(target, property, receiver);
      },
    }) as RoutePoint[];
    const route = {
      distanceKm: 49.999,
      route: observedPoints,
    } as QuestRoute;

    expect(routePathPose(route, 49_998.5)).toMatchObject({
      lat: 0,
      lng: 49.9985,
      elev: 49_998.5,
      progressM: 49_998.5,
    });
    expect(indexedReads).toBeLessThanOrEqual(64);
  });
});

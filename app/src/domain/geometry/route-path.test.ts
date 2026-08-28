import { describe, expect, it } from "vitest";

import type { QuestRoute, RoutePoint } from "@/domain/route";
import {
  bearingDegrees,
  routeDistanceM,
  routePathPose,
  type RoutePathPose,
} from "@/domain/geometry/route-path";

function referenceRoutePathPose(
  route: QuestRoute,
  progressM: number,
): RoutePathPose {
  const totalDistanceM = routeDistanceM(route);
  const boundedProgressM = Math.min(
    totalDistanceM,
    Math.max(0, progressM),
  );
  const points = route.route;
  if (points.length === 1) {
    const point = points[0];
    return {
      lat: point.lat,
      lng: point.lng,
      elev: point.elev,
      bearingDeg: 0,
      progressM: boundedProgressM,
      progressRatio: boundedProgressM / totalDistanceM,
    };
  }
  let upper = points.findIndex((point) => point.d >= boundedProgressM);
  if (upper <= 0) upper = 1;
  if (upper < 0) upper = points.length - 1;
  const start = points[upper - 1];
  const end = points[upper];
  const span = Math.max(1, end.d - start.d);
  const ratio = Math.min(
    1,
    Math.max(0, (boundedProgressM - start.d) / span),
  );
  const point = {
    lat: start.lat + (end.lat - start.lat) * ratio,
    lng: start.lng + (end.lng - start.lng) * ratio,
    elev: start.elev + (end.elev - start.elev) * ratio,
    d: boundedProgressM,
  };
  return {
    lat: point.lat,
    lng: point.lng,
    elev: point.elev,
    bearingDeg: bearingDegrees(point, end),
    progressM: boundedProgressM,
    progressRatio: boundedProgressM / totalDistanceM,
  };
}

function generatedRoute(pointCount: number, distanceOvershootM: number) {
  let distanceM = 0;
  const points = Array.from({ length: pointCount }, (_, index) => {
    if (index > 0 && index % 5 !== 0) distanceM += 3 + ((index * 17) % 11);
    return {
      lat: -30 + index * 0.013,
      lng: index % 7 === 0 ? 179 - index * 0.001 : -179 + index * 0.009,
      elev: 800 + ((index * 29) % 173),
      d: distanceM,
    };
  });
  return {
    distanceKm: (distanceM + distanceOvershootM) / 1_000,
    route: points,
  } as QuestRoute;
}

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

  it("matches the frozen linear oracle across dense monotonic route shapes", () => {
    for (const pointCount of [1, 2, 3, 7, 64, 101]) {
      for (const distanceOvershootM of [0, 0.49, 7]) {
        const route = generatedRoute(pointCount, distanceOvershootM);
        const distances = route.route.flatMap((point) => [
          point.d - 0.25,
          point.d,
          point.d + 0.25,
        ]);
        const queries = [
          -100,
          ...distances,
          routeDistanceM(route),
          routeDistanceM(route) + 100,
        ];
        for (const progressM of queries) {
          expect(routePathPose(route, progressM)).toEqual(
            referenceRoutePathPose(route, progressM),
          );
        }
      }
    }
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

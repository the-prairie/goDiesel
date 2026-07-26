import { describe, expect, it } from "vitest";

import type { QuestRoute } from "@/domain/routes";
import {
  ROUTE_TRAILER_DURATION_SECONDS,
  routeTrailerFrame,
} from "@/replay/cinematic-route-trailer-controller";

const route = {
  distanceKm: 20,
  centerLat: 35.2,
  centerLng: 24.8,
  route: [
    { lat: 35.1, lng: 24.7, elev: 20, d: 0 },
    { lat: 35.2, lng: 24.8, elev: 420, d: 10_000 },
    { lat: 35.3, lng: 24.9, elev: 80, d: 20_000 },
  ],
} as QuestRoute;

describe("cinematic route trailer controller", () => {
  it("moves through the authored chapters", () => {
    expect(routeTrailerFrame(route, 1).chapter).toBe("the-place");
    expect(routeTrailerFrame(route, 5).chapter).toBe("the-line");
    expect(routeTrailerFrame(route, 10).chapter).toBe("the-terrain");
    expect(routeTrailerFrame(route, 16).chapter).toBe("the-decision");
  });

  it("reveals the route before the pursuit shot", () => {
    const hidden = routeTrailerFrame(route, 2);
    const revealing = routeTrailerFrame(route, 5.5);
    const pursuit = routeTrailerFrame(route, 9);
    expect(hidden.reveal).toBeCloseTo(0.01);
    expect(revealing.reveal).toBeGreaterThan(hidden.reveal);
    expect(revealing.reveal).toBeLessThanOrEqual(1);
    expect(pursuit.reveal).toBe(1);
  });

  it("ends on a route-wide decision frame", () => {
    const frame = routeTrailerFrame(route, ROUTE_TRAILER_DURATION_SECONDS);
    expect(frame.showDecision).toBe(true);
    expect(frame.progress).toBe(1);
    expect(frame.routeProgressM).toBe(20_000);
    expect(frame.camera.center).toEqual({ lat: 35.2, lng: 24.8 });
    expect(frame.camera.rangeM).toBeGreaterThan(2_000);
  });
});

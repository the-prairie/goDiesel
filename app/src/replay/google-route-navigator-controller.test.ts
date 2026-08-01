import { describe, expect, it } from "vitest";

import type { QuestRoute } from "@/domain/routes";
import {
  advanceGoogleRouteNavigator,
  densifyGoogleRoutePath,
  googleRouteCameraPose,
  googleRouteTelemetry,
  initialGoogleRouteNavigatorState,
  smoothHeadingDegrees,
} from "@/replay/google-route-navigator-controller";

const route = {
  distanceKm: 2,
  centerLat: 51,
  centerLng: -1,
  route: [
    { lat: 51, lng: -1, elev: 20, d: 0, elapsedS: 0 },
    { lat: 51, lng: -0.99, elev: 30, d: 800, elapsedS: 240 },
    { lat: 51.01, lng: -0.99, elev: 40, d: 2_000, elapsedS: 600 },
  ],
  provenance: {
    temporal: { status: "recorded", elapsedTimeS: 600 },
    track: { segmentCount: 1 },
    discontinuities: [],
  },
} as unknown as QuestRoute;

describe("Google route navigator controller", () => {
  it("advances playback and stops at the route end", () => {
    const state = { ...initialGoogleRouteNavigatorState(), playing: true };
    const advanced = advanceGoogleRouteNavigator(state, 1, 2_000);
    expect(advanced.progressM).toBeGreaterThan(0);

    const finished = advanceGoogleRouteNavigator(
      { ...state, progressM: 1_999.9 },
      1,
      2_000,
    );
    expect(finished.progressM).toBe(2_000);
    expect(finished.playing).toBe(false);
  });

  it("keeps the runner camera close and the overview camera route-wide", () => {
    const initial = initialGoogleRouteNavigatorState();
    const runner = googleRouteCameraPose(route, {
      ...initial,
      cameraMode: "runner",
    });
    const chase = googleRouteCameraPose(route, {
      ...initial,
      cameraMode: "chase",
    });
    const overview = googleRouteCameraPose(route, {
      ...initial,
      cameraMode: "overview",
    });
    expect(runner.rangeM).toBe(14);
    expect(runner.tiltDeg).toBeGreaterThan(80);
    expect(chase.rangeM).toBeGreaterThan(200);
    expect(chase.tiltDeg).toBeLessThan(70);
    expect(initial.cameraMode).toBe("chase");
    expect(initial.groundingMode).toBe("mesh");
    expect(overview.rangeM).toBeGreaterThan(1_000);
    expect(overview.center).toMatchObject({ lat: 51, lng: -1 });
    expect(overview.center.altitude).toBeCloseTo(31.67, 1);
  });

  it("smooths headings across north without rotating the long way", () => {
    const next = smoothHeadingDegrees(355, 5, 0.5);
    expect(next).toBeCloseTo(0);
  });

  it("densifies long recorded segments for terrain following", () => {
    const path = densifyGoogleRoutePath(route, 20);
    expect(path.length).toBeGreaterThan(90);
    expect(path[0]).toEqual({ lat: 51, lng: -1 });
    expect(path.at(-1)).toEqual({ lat: 51.01, lng: -0.99 });
  });

  it("derives recorded telemetry at the current route distance", () => {
    const telemetry = googleRouteTelemetry(route, 1_000);

    expect(telemetry.elapsedS).toBeCloseTo(300);
    expect(telemetry.paceSPerKm).toBeCloseTo(300);
    expect(telemetry.elevationM).toBeCloseTo(31.67, 1);
    expect(telemetry.gradePercent).toBeGreaterThan(0);
    expect(telemetry.headingDeg).toBeGreaterThanOrEqual(0);
    expect(telemetry.headingDeg).toBeLessThan(360);
  });

  it("falls back to total elapsed time when points are not timed", () => {
    const untimed = {
      ...route,
      route: route.route.map(({ elapsedS: _, ...point }) => point),
    } as QuestRoute;

    expect(googleRouteTelemetry(untimed, 1_000).elapsedS).toBeCloseTo(300);
  });
});

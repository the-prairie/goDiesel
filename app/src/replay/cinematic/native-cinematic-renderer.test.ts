import { describe, expect, it } from "vitest";

import type { GoogleRouteCameraPose } from "@/replay/google-route-navigator-controller";
import { stabilizeCamera } from "@/replay/cinematic/native-cinematic-renderer";

const start: GoogleRouteCameraPose = {
  center: { lat: 37.76, lng: -122.45 },
  fovDeg: 44,
  headingDeg: 355,
  progressM: 1_000,
  rangeM: 2_000,
  tiltDeg: 48,
};

const target: GoogleRouteCameraPose = {
  center: { lat: 37.77, lng: -122.43 },
  fovDeg: 48,
  headingDeg: 5,
  progressM: 1_400,
  rangeM: 1_200,
  tiltDeg: 62,
};

describe("native cinematic camera stabilizer", () => {
  it("takes the shortest path across north", () => {
    const stabilized = stabilizeCamera(start, target, 1 / 15);
    expect(stabilized.headingDeg).toBeGreaterThan(355);
    expect(stabilized.headingDeg).toBeLessThan(360);
  });

  it("is stable across different render frame rates", () => {
    const oneStep = stabilizeCamera(start, target, 2 / 15);
    const halfStep = stabilizeCamera(start, target, 1 / 15);
    const twoSteps = stabilizeCamera(halfStep, target, 1 / 15);
    expect(twoSteps.center.lat).toBeCloseTo(oneStep.center.lat, 8);
    expect(twoSteps.center.lng).toBeCloseTo(oneStep.center.lng, 8);
    expect(twoSteps.headingDeg).toBeCloseTo(oneStep.headingDeg, 8);
    expect(twoSteps.rangeM).toBeCloseTo(oneStep.rangeM, 8);
  });

  it("uses the directed response time for fast and restrained shots", () => {
    const fast = stabilizeCamera(start, target, 0.1, 0.12);
    const restrained = stabilizeCamera(start, target, 0.1, 0.82);
    expect(Math.abs(fast.rangeM - target.rangeM)).toBeLessThan(
      Math.abs(restrained.rangeM - target.rangeM),
    );
    expect(Math.abs(fast.center.lng - target.center.lng)).toBeLessThan(
      Math.abs(restrained.center.lng - target.center.lng),
    );
  });

  it("clamps extremely short response times to a stable floor", () => {
    const clamped = stabilizeCamera(start, target, 0.1, 0.01);
    const floor = stabilizeCamera(start, target, 0.1, 0.08);
    expect(clamped).toEqual(floor);
  });
});

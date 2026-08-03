import { describe, expect, it } from "vitest";

import type { GoogleRouteCameraPose } from "@/replay/google-route-navigator-controller";
import {
  advanceRouteCameraMotion,
  createRouteCameraMotionState,
} from "@/replay/camera/route-camera-stabilizer";
import { stabilizeCamera } from "@/replay/cinematic/native-cinematic-renderer";
import {
  buildCinematicThreadStyles,
  slicePathByRatio,
} from "@/replay/cinematic/cinematic-route-filament";

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

  it("carries camera velocity continuously through changing targets", () => {
    let motion = createRouteCameraMotionState(start);
    const positions: number[] = [];
    for (let index = 0; index < 20; index += 1) {
      const desired = index < 8 ? target : { ...target, center: start.center };
      motion = advanceRouteCameraMotion(motion, desired, 1 / 30);
      positions.push(motion.pose.center.lng);
    }
    const velocities = positions.slice(1).map((value, index) => value - positions[index]);
    const peakVelocityChange = Math.max(
      ...velocities.slice(1).map((value, index) => Math.abs(value - velocities[index])),
    );

    expect(peakVelocityChange).toBeLessThan(0.0004);
  });
});

describe("cinematic route filament", () => {
  it("builds a legible guide, warm thread, and luminous focus", () => {
    const styles = buildCinematicThreadStyles(
      {
        endRatio: 0.68,
        focusRatio: 0.61,
        motionIntensity: 0.8,
        rangeM: 1_200,
        shotKind: "tracking",
        startRatio: 0.31,
      },
      21_500,
    );
    expect(styles).toHaveLength(4);
    const guide = styles.find(({ role }) => role === "guide");
    const thread = styles.find(({ role }) => role === "thread");
    const future = styles.find(({ role }) => role === "future");
    const glint = styles.find(({ role }) => role === "glint");
    expect(guide?.startRatio).toBe(0.31);
    expect(guide?.endRatio).toBe(0.68);
    expect(guide?.opacity ?? 0).toBeGreaterThan(0.4);
    expect(thread?.endRatio).toBe(0.61);
    expect(thread?.startRatio).toBe(0.31);
    expect(thread?.width ?? 0).toBeGreaterThan(2.4);
    expect(thread?.width ?? 0).toBeLessThanOrEqual(4.2);
    expect(thread?.outerWidth ?? 1).toBeLessThanOrEqual(0.2);
    expect(future?.opacity ?? 1).toBeLessThan(thread?.opacity ?? 0);
    expect(glint?.color).toBe("#fffdf1");
    expect(glint?.width ?? 0).toBeLessThanOrEqual(thread?.width ?? 0);
  });

  it("keeps the active route legible at chase-camera distance", () => {
    const styles = buildCinematicThreadStyles(
      {
        endRatio: 0.48,
        focusRatio: 0.42,
        motionIntensity: 0.8,
        rangeM: 260,
        shotKind: "tracking",
        startRatio: 0.37,
      },
      28_500,
    );
    const guide = styles.find(({ role }) => role === "guide");
    const thread = styles.find(({ role }) => role === "thread");
    expect(guide?.width ?? 0).toBeGreaterThan(1.4);
    expect(thread?.width ?? 0).toBeGreaterThan(2.4);
  });

  it("makes the complete route quieter for the release shot", () => {
    const tracking = buildCinematicThreadStyles(
      {
        endRatio: 0.9,
        focusRatio: 0.82,
        motionIntensity: 0.7,
        rangeM: 2_000,
        shotKind: "tracking",
        startRatio: 0.4,
      },
      21_500,
    );
    const release = buildCinematicThreadStyles(
      {
        endRatio: 1,
        focusRatio: 1,
        motionIntensity: 0.2,
        rangeM: 4_500,
        shotKind: "release",
        startRatio: 0,
      },
      21_500,
    );
    const opacity = (styles: typeof tracking, role: string) =>
      styles.find((style) => style.role === role)?.opacity ?? 0;
    expect(opacity(release, "thread")).toBeLessThan(
      opacity(tracking, "thread"),
    );
  });

  it("interpolates both ends of a route segment", () => {
    const path = [
      { lat: 0, lng: 0 },
      { lat: 10, lng: 10 },
      { lat: 20, lng: 20 },
    ];
    expect(slicePathByRatio(path, 0.25, 0.75)).toEqual([
      { lat: 5, lng: 5 },
      { lat: 10, lng: 10 },
      { lat: 15, lng: 15 },
    ]);
  });
});

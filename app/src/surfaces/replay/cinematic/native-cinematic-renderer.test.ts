import { describe, expect, it } from "vitest";

import type { GoogleRouteCameraPose } from "@/surfaces/replay/playback/route-navigator-controller";
import {
  advanceRouteCameraMotion,
  createRouteCameraMotionState,
} from "@/surfaces/replay/scene/route-camera-stabilizer";
import { stabilizeCamera } from "@/surfaces/replay/cinematic/native-cinematic-renderer";
import {
  buildCinematicThreadStyles,
  slicePathByRatio,
} from "@/surfaces/replay/cinematic/cinematic-route-filament";

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
  it("builds a quiet context trace, pearl future, coral history, and a short lead", () => {
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
    const context = styles.find(({ role }) => role === "context");
    const traveled = styles.find(({ role }) => role === "traveled");
    const future = styles.find(({ role }) => role === "future");
    const lead = styles.find(({ role }) => role === "lead");
    expect(context?.startRatio).toBe(0.31);
    expect(context?.endRatio).toBe(0.68);
    expect(context?.color).toBe("#f4efe7");
    expect(context?.opacity).toBe(0);
    expect(context?.outerWidth).toBeCloseTo(0.1);
    expect(traveled?.endRatio).toBe(0.61);
    expect(traveled?.startRatio).toBe(0.31);
    expect(traveled?.color).toBe("#f06b50");
    expect(traveled?.width ?? 0).toBeGreaterThan(2.2);
    expect(traveled?.width ?? 0).toBeLessThan(2.8);
    expect(traveled?.outerWidth).toBe(0);
    expect(future?.opacity ?? 1).toBeLessThan(traveled?.opacity ?? 0);
    expect(future?.color).toBe("#fffaf2");
    expect(future?.width ?? 99).toBeLessThan(traveled?.width ?? 0);
    expect(future?.startRatio ?? 0).toBeGreaterThan(lead?.startRatio ?? 1);
    expect(lead?.color).toBe("#ffd9c8");
    expect(lead?.outerWidth).toBe(0);
    expect(lead?.startRatio).toBe(0.61);
    expect(((lead?.endRatio ?? 0) - (lead?.startRatio ?? 0)) * 21_500).toBeCloseTo(
      110,
    );
    expect((lead?.endRatio ?? 0) - (lead?.startRatio ?? 1)).toBeLessThan(0.008);
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
    const traveled = styles.find(({ role }) => role === "traveled");
    const lead = styles.find(({ role }) => role === "lead");
    expect(traveled?.width ?? 0).toBeGreaterThan(2.2);
    expect(lead?.width ?? 0).toBeGreaterThan(traveled?.width ?? 0);
  });

  it("keeps the terrain thread legible in distant overview shots", () => {
    const close = buildCinematicThreadStyles(
      {
        endRatio: 0.48,
        focusRatio: 0.42,
        motionIntensity: 0.8,
        rangeM: 350,
        shotKind: "tracking",
        startRatio: 0.37,
      },
      28_500,
    );
    const overview = buildCinematicThreadStyles(
      {
        endRatio: 0.8,
        focusRatio: 0.42,
        motionIntensity: 0.8,
        rangeM: 6_000,
        shotKind: "establishing",
        startRatio: 0.08,
      },
      28_500,
    );
    const width = (styles: typeof close, role: string) =>
      styles.find((style) => style.role === role)?.width ?? 0;

    expect(width(overview, "context")).toBeGreaterThan(width(close, "context"));
    expect(width(overview, "future")).toBeGreaterThan(width(close, "future"));
    expect(width(overview, "traveled")).toBeGreaterThan(width(close, "traveled"));
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
    expect(opacity(release, "traveled")).toBeLessThan(
      opacity(tracking, "traveled"),
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

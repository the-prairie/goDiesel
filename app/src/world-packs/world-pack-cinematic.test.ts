import { describe, expect, it } from "vitest";

import {
  worldPackCameraDurationSeconds,
  worldPackCameraFrame,
  type WorldPackCameraTimeline,
} from "@/world-packs/world-pack-cinematic";

const timeline: WorldPackCameraTimeline = {
  durationFrames: 91,
  framesPerSecond: 30,
  keyframes: [
    { camera: [0, 10, 20], frame: 0, routePointIndex: 0, target: [0, 0, 0] },
    { camera: [30, 40, 50], frame: 90, routePointIndex: 30, target: [60, 0, 0] },
  ],
  schemaVersion: 1,
  timelineId: "test",
};

describe("World Pack cinematic timeline", () => {
  it("interpolates the sealed camera and route timing deterministically", () => {
    expect(worldPackCameraFrame(timeline, 1.5)).toEqual({
      camera: [15, 25, 35],
      frame: 45,
      routePointIndex: 15,
      target: [30, 0, 0],
    });
  });

  it("clamps seeks to the retained timeline", () => {
    expect(worldPackCameraFrame(timeline, -1).frame).toBe(0);
    expect(worldPackCameraFrame(timeline, 99).frame).toBe(90);
    expect(worldPackCameraDurationSeconds(timeline)).toBeCloseTo(91 / 30);
  });
});

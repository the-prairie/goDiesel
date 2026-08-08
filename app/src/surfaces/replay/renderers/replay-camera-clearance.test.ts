import { describe, expect, it } from "vitest";

import {
  advanceReplayCameraClearance,
  initialReplayCameraClearance,
  REPLAY_CAMERA_MIN_CLEARANCE_M,
  replayCameraClearanceM,
} from "@/surfaces/replay/renderers/replay-camera-clearance";

describe("replay camera clearance", () => {
  it("raises immediately above terrain at the camera position", () => {
    const state = advanceReplayCameraClearance(
      initialReplayCameraClearance(180),
      160,
      0.1,
      { kind: "sample", heightM: 260 },
    );

    expect(state.altitudeM).toBe(260 + REPLAY_CAMERA_MIN_CLEARANCE_M);
    expect(replayCameraClearanceM(state)).toBe(REPLAY_CAMERA_MIN_CLEARANCE_M);
  });

  it("holds the last safe altitude when a sample is missing or invalid", () => {
    const sampled = advanceReplayCameraClearance(
      initialReplayCameraClearance(400),
      180,
      0.1,
      { kind: "sample", heightM: 300 },
    );
    const missing = advanceReplayCameraClearance(sampled, 170, 1, {
      kind: "missing",
    });
    const invalid = advanceReplayCameraClearance(missing, 160, 1, {
      kind: "sample",
      heightM: Number.NaN,
    });

    expect(missing.altitudeM).toBe(sampled.altitudeM);
    expect(invalid.altitudeM).toBeGreaterThanOrEqual(
      300 + REPLAY_CAMERA_MIN_CLEARANCE_M,
    );
  });

  it("eases downward after terrain falls away", () => {
    const state = advanceReplayCameraClearance(
      {
        altitudeM: 500,
        lastValidSurfaceHeightM: 300,
      },
      160,
      0.25,
      { kind: "sample", heightM: 100 },
    );

    expect(state.altitudeM).toBe(470);
    expect(state.lastValidSurfaceHeightM).toBe(100);
  });

  it("leaves the initial overview as soon as the first terrain sample arrives", () => {
    const state = advanceReplayCameraClearance(
      initialReplayCameraClearance(5_000),
      180,
      0.1,
      { kind: "sample", heightM: 200 },
    );

    expect(state.altitudeM).toBe(200 + REPLAY_CAMERA_MIN_CLEARANCE_M);
  });

  it("supports a route-specific minimum clearance", () => {
    const state = advanceReplayCameraClearance(
      initialReplayCameraClearance(100),
      100,
      0,
      { kind: "sample", heightM: 100 },
      80,
    );

    expect(replayCameraClearanceM(state)).toBe(80);
  });

});

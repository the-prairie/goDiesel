import { describe, expect, it } from "vitest";

import type { QuestRoute } from "@/domain/routes";
import {
  PLAYABLE_EARTH_CORRIDOR_M,
  advancePlayableEarth,
  cyclePlayableEarthSpeed,
  initialPlayableEarthState,
  playableEarthPose,
  seekPlayableEarth,
  setPlayableEarthMode,
} from "@/replay/playable-earth-controller";

const route = {
  distanceKm: 1,
  route: [
    { lat: 51, lng: -114, elev: 100, d: 0 },
    { lat: 51.005, lng: -114, elev: 120, d: 500 },
    { lat: 51.01, lng: -114, elev: 140, d: 1_000 },
  ],
} as QuestRoute;

describe("Playable Earth controller", () => {
  it("advances only while playing and preserves progress across modes", () => {
    const initial = initialPlayableEarthState();
    expect(advancePlayableEarth(initial, 1, { steer: 0, look: 0 }, 1_000)).toEqual(
      initial,
    );

    const playing = { ...initial, playing: true, progressM: 100 };
    const advanced = advancePlayableEarth(
      playing,
      1,
      { steer: 0, look: 0 },
      1_000,
    );
    expect(advanced.progressM).toBeGreaterThan(100);
    expect(setPlayableEarthMode(advanced, "guided").progressM).toBe(
      advanced.progressM,
    );
  });

  it("constrains lateral steering and camera look", () => {
    let state = setPlayableEarthMode(initialPlayableEarthState(), "guided");
    for (let index = 0; index < 500; index += 1) {
      state = advancePlayableEarth(state, 0.1, { steer: 1, look: 1 }, 1_000);
    }
    expect(state.lateralOffsetM).toBe(PLAYABLE_EARTH_CORRIDOR_M);
    expect(state.cameraYawDeg).toBe(65);

    const replay = advancePlayableEarth(
      setPlayableEarthMode(state, "replay"),
      0.1,
      { steer: 0, look: 0 },
      1_000,
    );
    expect(replay.lateralOffsetM).toBeLessThan(state.lateralOffsetM);
    expect(replay.cameraYawDeg).toBeLessThan(state.cameraYawDeg);
  });

  it("interpolates route position and applies lateral offset", () => {
    const state = {
      ...setPlayableEarthMode(initialPlayableEarthState(), "guided"),
      progressM: 250,
      lateralOffsetM: 10,
      cameraYawDeg: 20,
    };
    const pose = playableEarthPose(route, state);
    expect(pose.lat).toBeCloseTo(51.0025, 4);
    expect(pose.lng).toBeGreaterThan(-114);
    expect(pose.elev).toBeCloseTo(110);
    expect(pose.progressRatio).toBeCloseTo(0.25);
    expect(pose.cameraHeadingDeg).toBeCloseTo(pose.bearingDeg + 20);
  });

  it("cycles pace and clamps seeking", () => {
    let state = initialPlayableEarthState();
    state = cyclePlayableEarthSpeed(state, 1);
    expect(state.speed).toBe(2);
    state = cyclePlayableEarthSpeed(state, -1);
    expect(state.speed).toBe(1);
    expect(seekPlayableEarth(state, 2_000, 1_000).progressM).toBe(1_000);
    expect(seekPlayableEarth(state, -100, 1_000).progressM).toBe(0);
  });
});

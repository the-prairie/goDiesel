import { describe, expect, it } from "vitest";

import type { QuestRoute } from "@/domain/routes";
import {
  PLAYABLE_EARTH_CORRIDOR_M,
  PLAYABLE_EARTH_CAMERA_RANGES_M,
  advancePlayableEarthGrounding,
  advancePlayableEarth,
  cyclePlayableEarthSpeed,
  initialPlayableEarthState,
  initialPlayableEarthGrounding,
  playableEarthPose,
  seekPlayableEarth,
  setPlayableEarthMode,
  zoomPlayableEarth,
} from "@/labs/playable-earth/playable-earth-controller";

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

  it("zooms through bounded route-follow ranges without changing route state", () => {
    const initial = {
      ...setPlayableEarthMode(initialPlayableEarthState(), "guided"),
      playing: true,
      progressM: 320,
      lateralOffsetM: 8,
      cameraYawDeg: 24,
    };
    const closer = zoomPlayableEarth(initial, "in");
    expect(closer.cameraRangeM).toBe(240);
    expect(closer).toMatchObject({
      mode: "guided",
      playing: true,
      progressM: 320,
      lateralOffsetM: 8,
      cameraYawDeg: 24,
    });
    expect(zoomPlayableEarth(closer, "in").cameraRangeM).toBe(120);
    expect(zoomPlayableEarth(zoomPlayableEarth(closer, "in"), "in").cameraRangeM).toBe(
      120,
    );

    let wider = initial;
    for (let index = 0; index < 5; index += 1) {
      wider = zoomPlayableEarth(wider, "out");
    }
    expect(wider.cameraRangeM).toBe(PLAYABLE_EARTH_CAMERA_RANGES_M.at(-1));
  });

  it("accepts plausible surface samples and smooths height changes", () => {
    const initial = initialPlayableEarthGrounding(100);
    const sampled = advancePlayableEarthGrounding(initial, 100, 0.1, {
      kind: "sample",
      heightM: 112,
    });

    expect(sampled).toMatchObject({
      source: "sampled",
      reason: "sampled",
      stableOffsetM: 12,
    });
    expect(sampled.displayedHeightM).toBeCloseTo(102.4);
    expect(sampled.displayedHeightM).toBeLessThan(112);
  });

  it("uses recorded elevation when samples are missing", () => {
    const sampled = {
      ...initialPlayableEarthGrounding(100),
      displayedHeightM: 112,
      stableOffsetM: 12,
      source: "sampled" as const,
      reason: "sampled" as const,
    };
    const fallback = advancePlayableEarthGrounding(sampled, 101, 0.1, {
      kind: "missing",
    });

    expect(fallback).toMatchObject({ source: "fallback", reason: "missing" });
    expect(fallback.displayedHeightM).toBeCloseTo(109.6);
    expect(fallback.displayedHeightM).toBeGreaterThan(101);
  });

  it("rejects implausible and rapidly changing tile samples", () => {
    const initial = initialPlayableEarthGrounding(100);
    const impossible = advancePlayableEarthGrounding(initial, 100, 0.1, {
      kind: "sample",
      heightM: 500,
    });
    expect(impossible).toMatchObject({ source: "fallback", reason: "outlier" });

    const stable = advancePlayableEarthGrounding(initial, 100, 0.1, {
      kind: "sample",
      heightM: 112,
    });
    const lodJump = advancePlayableEarthGrounding(stable, 101, 0.1, {
      kind: "sample",
      heightM: 150,
    });
    expect(lodJump).toMatchObject({
      source: "fallback",
      reason: "outlier",
      stableOffsetM: 12,
    });
  });

  it("tracks route elevation without teleporting when tile detail changes", () => {
    let grounding = initialPlayableEarthGrounding(100);
    grounding = advancePlayableEarthGrounding(grounding, 100, 0.1, {
      kind: "sample",
      heightM: 110,
    });
    const before = grounding.displayedHeightM;
    grounding = advancePlayableEarthGrounding(grounding, 104, 0.1, {
      kind: "sample",
      heightM: 116,
    });

    expect(grounding.source).toBe("sampled");
    expect(grounding.stableOffsetM).toBeCloseTo(10.5);
    expect(grounding.displayedHeightM - before).toBeCloseTo(2.4, 8);
  });
});

import { describe, expect, it } from "vitest";

import {
  initialReplaySessionState,
  reduceReplaySession,
  type ReplaySessionEvent,
  type ReplaySessionState,
} from "@/surfaces/replay/playback/replay-session-state";

function run(...events: ReplaySessionEvent[]) {
  return events.reduce(reduceReplaySession, initialReplaySessionState());
}

const tick = { type: "frameElapsed", elapsedSeconds: 0.1, totalDistanceM: 2_100 } as const;
const play = { type: "playbackToggled" } as const;

describe("native Replay session commands", () => {
  it("starts paused with the automatic camera following the route", () => {
    expect(initialReplaySessionState()).toEqual({
      playing: false,
      progressM: 0,
      speed: 1,
      cameraMode: "auto",
      following: true,
      groundingMode: "ground",
      rangeScale: 1,
    });
  });

  it("advances only while playing and resumes from the paused distance", () => {
    expect(run(tick).progressM).toBe(0);
    const paused = run(play, tick, play, tick);
    expect(paused).toMatchObject({ playing: false, progressM: 1 });
    expect(reduceReplaySession(reduceReplaySession(paused, play), tick)).toMatchObject({
      playing: true, progressM: 2,
    });
  });

  it.each([false, true])("seeking keeps playing=%s until the next frame", (playing) => {
    let state: ReplaySessionState = { ...initialReplaySessionState(), playing };
    state = reduceReplaySession(state, { type: "progressSelected", progressM: 3_000, totalDistanceM: 2_100 });
    expect(state).toMatchObject({ playing, progressM: 2_100 });
    expect(reduceReplaySession(state, tick)).toMatchObject({ playing: false, progressM: 2_100 });
    state = reduceReplaySession(state, { type: "progressSelected", progressM: -1, totalDistanceM: 2_100 });
    expect(state).toMatchObject({ playing, progressM: 0 });
  });

  it("playing at the endpoint never rewinds", () => {
    const state = run({ type: "progressSelected", progressM: 2_100, totalDistanceM: 2_100 }, play);
    expect(state).toMatchObject({ playing: true, progressM: 2_100 });
    expect(reduceReplaySession(state, tick)).toMatchObject({ playing: false, progressM: 2_100 });
  });

  it("cycles speed without changing progress or playback intent", () => {
    let state = run(play, tick);
    for (const speed of [2, 4, 0.5, 1]) {
      state = reduceReplaySession(state, { type: "speedCycled" });
      expect(state).toMatchObject({ speed, playing: true, progressM: 1 });
    }
  });

  it("allows free exploration while playback continues", () => {
    const state = run(play, { type: "followingChanged", following: false }, tick);
    expect(state).toMatchObject({ playing: true, following: false, progressM: 1, cameraMode: "auto" });
    expect(reduceReplaySession(state, { type: "followingChanged", following: true })).toMatchObject({
      playing: true, following: true, progressM: 1, cameraMode: "auto",
    });
  });

  it.each(["auto", "runner", "chase", "overview"] as const)("selecting %s reclaims camera ownership", (cameraMode) => {
    const state = run(play, tick, { type: "followingChanged", following: false }, { type: "cameraSelected", cameraMode });
    expect(state).toMatchObject({ playing: true, progressM: 1, following: true, cameraMode });
  });

  it("grounding and zoom do not reclaim camera ownership or change playback", () => {
    const state = run(play, tick, { type: "followingChanged", following: false });
    const grounded = reduceReplaySession(state, { type: "groundingSelected", groundingMode: "ground" });
    expect(grounded).toEqual({ ...state, groundingMode: "ground" });
    const zoomed = reduceReplaySession(grounded, { type: "zoomRequested", direction: "in" });
    expect(zoomed).toEqual({ ...grounded, rangeScale: 0.78 });
    expect(reduceReplaySession(zoomed, { type: "zoomRequested", direction: "out" })).toEqual({
      ...grounded, rangeScale: 0.78 * 1.28,
    });
  });

  it("replacement resets every session control", () => {
    const state = run(play, tick,
      { type: "speedCycled" },
      { type: "cameraSelected", cameraMode: "runner" },
      { type: "followingChanged", following: false },
      { type: "groundingSelected", groundingMode: "ground" },
      { type: "zoomRequested", direction: "in" },
      { type: "routeReplaced" });
    expect(state).toEqual(initialReplaySessionState());
  });

  it("does not mutate the input session", () => {
    const state = Object.freeze(initialReplaySessionState());
    expect(reduceReplaySession(state, play).playing).toBe(true);
    expect(state.playing).toBe(false);
  });
});

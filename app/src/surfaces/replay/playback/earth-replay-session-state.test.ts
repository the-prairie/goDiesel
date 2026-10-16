import { describe, expect, it } from "vitest";
import {
  initialEarthReplaySessionState,
  reduceEarthReplaySession,
  type EarthReplaySessionEvent,
  type EarthReplaySessionState,
} from "@/surfaces/replay/playback/earth-replay-session-state";
import type { ReplayStatus } from "@/surfaces/replay/renderer-port";

function transition(state: EarthReplaySessionState, ...events: EarthReplaySessionEvent[]) {
  return events.reduce(reduceEarthReplaySession, state);
}

function mounted(state: ReplayStatus["state"] = "ready") {
  return transition(initialEarthReplaySessionState("earth"),
    { type: "rendererMounted", routeSlug: "city" },
    { type: "statusReceived", sessionId: 1, status: { state, title: "World", message: "Outcome" } },
  );
}

const changedControls: EarthReplaySessionEvent[] = [
  { type: "progressSelected", progressM: 500, totalDistanceM: 1000 },
  { type: "speedCycled" },
  { type: "followingToggled" },
  { type: "zoomRequested", direction: "out" },
  { type: "playbackToggled" },
];

describe("Earth Replay session", () => {
  it.each(["earth", "atlas"] as const)("starts %s paused with its loading message", (mode) => {
    expect(initialEarthReplaySessionState(mode)).toMatchObject({
      engineMode: mode, sessionId: 0, routeSlug: undefined,
      status: { state: "loading", title: mode === "earth" ? "Building your route world" : "Opening Atlas replay" },
      control: { playing: false, progressM: 0, speed: 1, following: true, cameraRangeM: 240 },
    });
  });

  it("preserves controls and playback intent when replacing the same route renderer", () => {
    const switched = transition(mounted(), ...changedControls,
      { type: "rendererSelected", mode: "atlas" },
      { type: "rendererMounted", routeSlug: "city" });
    expect(switched).toMatchObject({ engineMode: "atlas", sessionId: 2, status: { state: "loading" } });
    expect(switched.control).toEqual({ playing: true, progressM: 500, speed: 2, following: false, cameraRangeM: 720 });
    expect(reduceEarthReplaySession(switched, { type: "frameElapsed", elapsedSeconds: 1, totalDistanceM: 1000 })).toBe(switched);
  });

  it("resets every control on a different route and keeps the selected renderer", () => {
    expect(transition(mounted(), ...changedControls, { type: "rendererSelected", mode: "atlas" },
      { type: "rendererMounted", routeSlug: "mountain" })).toMatchObject({
      routeSlug: "mountain", engineMode: "atlas", sessionId: 2,
      control: { playing: false, progressM: 0, speed: 1, following: true, cameraRangeM: 240 },
    });
  });

  it.each(["ready", "partial"] as const)("advances while %s and stops at the endpoint", (status) => {
    const advanced = transition(mounted(status), { type: "playbackToggled" },
      { type: "frameElapsed", elapsedSeconds: 10, totalDistanceM: 1800 });
    expect(advanced.control).toMatchObject({ playing: true, progressM: 1 });
    expect(transition(advanced, { type: "progressSelected", progressM: 1799.5, totalDistanceM: 1800 },
      { type: "frameElapsed", elapsedSeconds: 0.1, totalDistanceM: 1800 }).control)
      .toMatchObject({ playing: false, progressM: 1800 });
  });

  it.each(["loading", "unavailable"] as const)("freezes while %s without losing playback intent", (status) => {
    const state = transition(mounted(), ...changedControls,
      { type: "statusReceived", sessionId: 1, status: { state: status, title: "Wait", message: "Provider" } });
    expect(reduceEarthReplaySession(state, { type: "frameElapsed", elapsedSeconds: 0.1, totalDistanceM: 1000 })).toBe(state);
    const recovered = transition(state,
      { type: "statusReceived", sessionId: 1, status: { state: "partial", title: "Recovered", message: "Gaps" } },
      { type: "frameElapsed", elapsedSeconds: 0.1, totalDistanceM: 1000 });
    expect(recovered.control.playing).toBe(true);
    expect(recovered.control.progressM).toBeGreaterThan(500);
  });

  it("rejects superseded renderer outcomes including stale success", () => {
    const state = transition(mounted(), { type: "rendererMounted", routeSlug: "city" });
    for (const status of ["loading", "ready", "partial", "unavailable"] as const) {
      expect(reduceEarthReplaySession(state, { type: "statusReceived", sessionId: 1,
        status: { state: status, title: "Stale", message: "Stale" } })).toBe(state);
    }
  });

  it("does not change an already selected renderer", () => {
    const state = mounted();
    expect(reduceEarthReplaySession(state, { type: "rendererSelected", mode: "earth" })).toBe(state);
  });

  it("bounds seeks and preserves pause while seeking", () => {
    const state = mounted();
    expect(reduceEarthReplaySession(state, { type: "progressSelected", progressM: -100, totalDistanceM: 1000 }).control.progressM).toBe(0);
    expect(reduceEarthReplaySession(state, { type: "progressSelected", progressM: 2000, totalDistanceM: 1000 }).control).toMatchObject({ progressM: 1000, playing: false });
    expect(transition(state, { type: "playbackToggled" }, { type: "progressSelected", progressM: 2000, totalDistanceM: 1000 }).control.playing).toBe(false);
  });

  it("cycles speed and bounds zoom without changing progress or follow", () => {
    let state = mounted();
    for (const speed of [2, 4, 0.5, 1]) {
      state = reduceEarthReplaySession(state, { type: "speedCycled" });
      expect(state.control.speed).toBe(speed);
    }
    for (const range of [720, 1400, 1400]) {
      state = reduceEarthReplaySession(state, { type: "zoomRequested", direction: "out" });
      expect(state.control.cameraRangeM).toBe(range);
    }
    for (const range of [720, 240, 120, 120]) {
      state = reduceEarthReplaySession(state, { type: "zoomRequested", direction: "in" });
      expect(state.control.cameraRangeM).toBe(range);
    }
    expect(state.control).toMatchObject({ progressM: 0, following: true, playing: false });
  });
});

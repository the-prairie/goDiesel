import { describe, expect, it } from "vitest";
import {
  earthReplayChromeMayAutoHide,
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

  it("keeps a range the person chose on the renderer when playback starts", () => {
    const chosen = transition(mounted(), { type: "cameraRangeChosen", cameraRangeM: 3_959.6 });
    expect(transition(chosen, { type: "playbackToggled" }).control)
      .toMatchObject({ playing: true, following: true, cameraRangeM: 3_960 });
  });

  it("applies the opening follow range on play only when the person has not zoomed", () => {
    expect(transition(mounted(), { type: "playbackToggled" }).control)
      .toMatchObject({ playing: true, following: true, cameraRangeM: 240 });
    const zoomedOut = transition(mounted(), { type: "zoomRequested", direction: "out" });
    expect(transition(zoomedOut, { type: "playbackToggled" }).control.cameraRangeM).toBe(720);
  });

  it("bounds a chosen range and ignores one that changes nothing", () => {
    expect(transition(mounted(), { type: "cameraRangeChosen", cameraRangeM: 5 }).control.cameraRangeM).toBe(30);
    expect(transition(mounted(), { type: "cameraRangeChosen", cameraRangeM: 1e9 }).control.cameraRangeM).toBe(90_000);
    const state = mounted();
    expect(reduceEarthReplaySession(state, { type: "cameraRangeChosen", cameraRangeM: 240.2 })).toBe(state);
    expect(reduceEarthReplaySession(state, { type: "cameraRangeChosen", cameraRangeM: Number.NaN })).toBe(state);
  });

  it("steps from a chosen range to the nearest preset in the requested direction", () => {
    const between = transition(mounted(), { type: "cameraRangeChosen", cameraRangeM: 500 });
    expect(reduceEarthReplaySession(between, { type: "zoomRequested", direction: "in" }).control.cameraRangeM).toBe(240);
    expect(reduceEarthReplaySession(between, { type: "zoomRequested", direction: "out" }).control.cameraRangeM).toBe(720);
    const far = transition(mounted(), { type: "cameraRangeChosen", cameraRangeM: 5_000 });
    expect(reduceEarthReplaySession(far, { type: "zoomRequested", direction: "in" }).control.cameraRangeM).toBe(1_400);
    expect(reduceEarthReplaySession(far, { type: "zoomRequested", direction: "out" }).control.cameraRangeM).toBe(5_000);
    const near = transition(mounted(), { type: "cameraRangeChosen", cameraRangeM: 60 });
    expect(reduceEarthReplaySession(near, { type: "zoomRequested", direction: "out" }).control.cameraRangeM).toBe(120);
  });

  it("carries a chosen range across a renderer switch on the same route", () => {
    const switched = transition(mounted(), { type: "cameraRangeChosen", cameraRangeM: 3_000 },
      { type: "rendererSelected", mode: "atlas" }, { type: "rendererMounted", routeSlug: "city" });
    expect(switched.control.cameraRangeM).toBe(3_000);
  });

  it("keeps controls, route, and session id when the person picks another renderer", () => {
    const before = transition(mounted("partial"), ...changedControls);
    const switched = reduceEarthReplaySession(before, { type: "rendererSelected", mode: "atlas" });
    expect(switched).toMatchObject({ engineMode: "atlas", routeSlug: "city", sessionId: 1 });
    expect(switched.control).toBe(before.control);
  });

  it("switches Atlas back to Earth with the same controls", () => {
    const back = transition(mounted(), ...changedControls,
      { type: "rendererSelected", mode: "atlas" },
      { type: "rendererMounted", routeSlug: "city" },
      { type: "statusReceived", sessionId: 2, status: { state: "ready", title: "Atlas", message: "Ready" } },
      { type: "rendererSelected", mode: "earth" },
      { type: "rendererMounted", routeSlug: "city" });
    expect(back).toMatchObject({ engineMode: "earth", sessionId: 3, status: { state: "loading" } });
    expect(back.control).toEqual({ playing: true, progressM: 500, speed: 2, following: false, cameraRangeM: 720 });
  });

  it("accepts the outcome of the current engine after a renderer switch", () => {
    const state = transition(mounted(), { type: "rendererSelected", mode: "atlas" },
      { type: "rendererMounted", routeSlug: "city" },
      { type: "statusReceived", sessionId: 2, status: { state: "ready", title: "Atlas", message: "Ready" } });
    expect(state.status).toMatchObject({ state: "ready", title: "Atlas" });
  });

  it.each([["earth", "atlas", "Opening Atlas replay"], ["atlas", "earth", "Building your route world"]] as const)(
    "resets provider status when switching %s to %s so mode and status agree",
    (from, to, title) => {
      const state = transition(initialEarthReplaySessionState(from),
        { type: "rendererMounted", routeSlug: "city" },
        { type: "statusReceived", sessionId: 1, status: { state: "partial", title: "Old", message: "Old engine" } },
        { type: "rendererSelected", mode: to });
      expect(state).toMatchObject({ engineMode: to, status: { state: "loading", title } });
      expect(reduceEarthReplaySession(state, { type: "frameElapsed", elapsedSeconds: 1, totalDistanceM: 1000 })).toBe(state);
    },
  );
});

describe("Earth Replay HUD", () => {
  it("starts with the desktop preview and collapsed mobile controls", () => {
    expect(initialEarthReplaySessionState("earth")).toMatchObject({
      contextState: "preview", mobileControlsExpanded: false,
    });
  });

  it.each([[true, "compact"], [false, "preview"]] as const)(
    "resets presentation for mobile=%s to %s and collapses controls",
    (isMobile, contextState) => {
      const state = transition(mounted(),
        { type: "contextChanged", contextState: "expanded" },
        { type: "mobileControlsToggled" },
        { type: "presentationReset", isMobile });
      expect(state).toMatchObject({ contextState, mobileControlsExpanded: false });
    },
  );

  it("toggles mobile controls without touching playback", () => {
    const base = mounted();
    const opened = reduceEarthReplaySession(base, { type: "mobileControlsToggled" });
    expect(opened.mobileControlsExpanded).toBe(true);
    expect(opened.control).toBe(base.control);
    expect(reduceEarthReplaySession(opened, { type: "mobileControlsToggled" }).mobileControlsExpanded).toBe(false);
  });

  it.each(["preview", "expanded"] as const)("compacts a %s HUD in the same transition as play", (contextState) => {
    const playing = transition(mounted(),
      { type: "contextChanged", contextState },
      { type: "playbackToggled" });
    expect(playing).toMatchObject({ contextState: "compact", control: { playing: true } });
  });

  it("leaves the HUD alone on pause", () => {
    const paused = transition(mounted(), { type: "playbackToggled" },
      { type: "contextChanged", contextState: "expanded" },
      { type: "playbackToggled" });
    expect(paused).toMatchObject({ contextState: "expanded", control: { playing: false } });
  });

  it("keeps a HUD the person expands during playback", () => {
    const state = transition(mounted(), { type: "playbackToggled" },
      { type: "contextChanged", contextState: "expanded" },
      { type: "frameElapsed", elapsedSeconds: 0.1, totalDistanceM: 1000 },
      { type: "speedCycled" },
      { type: "progressSelected", progressM: 200, totalDistanceM: 1000 });
    expect(state).toMatchObject({ contextState: "expanded", control: { playing: true } });
  });

  it("compacts again when playback restarts after reaching the endpoint", () => {
    const ended = transition(mounted(), { type: "playbackToggled" },
      { type: "contextChanged", contextState: "expanded" },
      { type: "progressSelected", progressM: 999.9, totalDistanceM: 1000 },
      { type: "frameElapsed", elapsedSeconds: 1, totalDistanceM: 1000 });
    expect(ended).toMatchObject({ contextState: "expanded", control: { playing: false } });
    expect(reduceEarthReplaySession(ended, { type: "playbackToggled" }).contextState).toBe("compact");
  });

  it("keeps the HUD and mobile controls across an in-stage renderer switch", () => {
    const state = transition(mounted("partial"),
      { type: "contextChanged", contextState: "expanded" },
      { type: "mobileControlsToggled" },
      { type: "rendererSelected", mode: "atlas" },
      { type: "rendererMounted", routeSlug: "city" });
    expect(state).toMatchObject({ contextState: "expanded", mobileControlsExpanded: true });
  });

  it("returns the same state for a HUD change that changes nothing", () => {
    const state = mounted();
    expect(reduceEarthReplaySession(state, { type: "contextChanged", contextState: "preview" })).toBe(state);
  });
});

describe("Earth Replay chrome auto-hide", () => {
  const motion = { reducedMotion: false };

  it("never hides chrome while paused", () => {
    expect(earthReplayChromeMayAutoHide(mounted("ready"), motion)).toBe(false);
  });

  it.each(["ready", "partial"] as const)("may hide chrome while playing a %s scene", (status) => {
    expect(earthReplayChromeMayAutoHide(transition(mounted(status), { type: "playbackToggled" }), motion)).toBe(true);
  });

  it.each(["loading", "unavailable"] as const)("keeps chrome while playback intent survives %s", (status) => {
    const state = transition(mounted(), { type: "playbackToggled" },
      { type: "statusReceived", sessionId: 1, status: { state: status, title: "Wait", message: "Provider" } });
    expect(state.control.playing).toBe(true);
    expect(earthReplayChromeMayAutoHide(state, motion)).toBe(false);
  });

  it("keeps chrome while a newly selected renderer loads", () => {
    const state = transition(mounted("partial"), { type: "playbackToggled" },
      { type: "rendererSelected", mode: "atlas" });
    expect(earthReplayChromeMayAutoHide(state, motion)).toBe(false);
  });

  it("keeps chrome under reduced motion", () => {
    expect(earthReplayChromeMayAutoHide(transition(mounted(), { type: "playbackToggled" }), { reducedMotion: true })).toBe(false);
  });
});

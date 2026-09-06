import { describe, expect, it } from "vitest";
import { advanceGoogleRouteNavigator, initialGoogleRouteNavigatorState } from "../playback/route-navigator-controller";
import { WorldContinuity } from "./world-continuity";
describe("landscape-aware transport", () => {
  it("ignores a single missing frame, holds a sustained hole and resumes only after stable coverage", () => {
    const continuity = new WorldContinuity();
    expect(continuity.update(0,true,false)).toBe(false);
    expect(continuity.update(16,true,true)).toBe(false);
    expect(continuity.update(40,true,false)).toBe(false);
    expect(continuity.update(240,true,false)).toBe(true);
    expect(continuity.update(250,true,true)).toBe(true);
    expect(continuity.update(450,true,false)).toBe(true);
    expect(continuity.update(500,true,true)).toBe(true);
    expect(continuity.update(749,true,true)).toBe(true);
    expect(continuity.update(750,true,true)).toBe(false);
  });
  it("holds distance without stealing Play/Pause, then resumes without catching up lost time", () => {
    const continuity = new WorldContinuity();
    continuity.update(0,true,false); continuity.update(250,true,false);
    const state = { ...initialGoogleRouteNavigatorState(), playing:true, progressM:9850 };
    const held = advanceGoogleRouteNavigator(state, continuity.holding ? 0 : 0.1, 15100);
    expect(held).toEqual(state);
    continuity.update(1000,true,true); continuity.update(1250,true,true);
    const resumed = advanceGoogleRouteNavigator(held, continuity.holding ? 0 : 0.016,15100);
    expect(resumed.progressM).toBeGreaterThan(9850);
    expect(resumed.progressM).toBeLessThan(9852);
    expect(continuity.update(1260,false,false)).toBe(false);
  });
});

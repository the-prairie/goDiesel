import { describe, expect, it } from "vitest";
import {
  initialRegionalFallbackState, reduceRegionalFallback,
  type RegionalFallbackEvent,
} from "./regional-fallback-state";

const start = { type: "sessionStarted", session: 1, hasGeometry: true } as const;
const loaded = { type: "mapLoaded", session: 1 } as const;
const error = { type: "mapErrored", session: 1 } as const;
const timeout = { type: "loadTimedOut", session: 1 } as const;
const failed = { type: "constructionFailed", session: 1 } as const;
const run = (...events: RegionalFallbackEvent[]) => events.reduce(reduceRegionalFallback, initialRegionalFallbackState());

describe("regional fallback lifecycle", () => {
  it("starts loading with a fresh error budget", () => {
    expect(run(start)).toEqual({ phase: "loading", session: 1, errors: 0 });
  });

  it("requires valid recorded geometry before loading a map", () => {
    const state = run({ ...start, hasGeometry: false });
    expect(state).toEqual({ phase: "unavailable", session: 1, reason: "geometry" });
    expect(reduceRegionalFallback(state, loaded)).toBe(state);
  });

  it("becomes unavailable on the fourth error and can recover on late load", () => {
    const three = run(start, error, error, error);
    expect(three).toEqual({ phase: "loading", session: 1, errors: 3 });
    const four = reduceRegionalFallback(three, error);
    expect(four).toEqual({ phase: "unavailable", session: 1, reason: "errors" });
    expect(reduceRegionalFallback(four, loaded)).toEqual({ phase: "ready", session: 1 });
  });

  it("recovers when the style loads after the deadline", () => {
    expect(run(start, timeout)).toEqual({ phase: "unavailable", session: 1, reason: "timeout" });
    expect(run(start, timeout, loaded)).toEqual({ phase: "ready", session: 1 });
  });

  it("does not recover from a construction failure without a new session", () => {
    const state = run(start, failed);
    expect(state).toEqual({ phase: "unavailable", session: 1, reason: "construction" });
    expect(reduceRegionalFallback(state, loaded)).toBe(state);
    expect(reduceRegionalFallback(state, { ...start, session: 2 })).toEqual({ phase: "loading", session: 2, errors: 0 });
  });

  it.each([error, timeout, failed, loaded])("keeps a loaded map ready after $type", event => {
    const state = run(start, loaded);
    expect(reduceRegionalFallback(state, event)).toBe(state);
  });

  it.each([error, timeout, failed, loaded])("ignores an old region's $type", event => {
    const state = run(start, error, { ...start, session: 2 });
    expect(state).toEqual({ phase: "loading", session: 2, errors: 0 });
    expect(reduceRegionalFallback(state, event)).toBe(state);
  });

  it("does not restart the current session on duplicate or stale start events", () => {
    const state = run(start, loaded);
    expect(reduceRegionalFallback(state, start)).toBe(state);
    expect(reduceRegionalFallback(state, { ...start, session: 0 })).toBe(state);
  });

  it("resets readiness when a new region starts or lacks geometry", () => {
    const state = run(start, loaded);
    expect(reduceRegionalFallback(state, { ...start, session: 2 })).toEqual({ phase: "loading", session: 2, errors: 0 });
    expect(reduceRegionalFallback(state, { ...start, session: 2, hasGeometry: false })).toEqual({ phase: "unavailable", session: 2, reason: "geometry" });
  });
});

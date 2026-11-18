import { describe, expect, it } from "vitest";

import { initialSketchMapState, reduceSketchMap, type SketchMapEvent, type SketchMapState } from "@/labs/sketch/sketch-map-state";

const run = (events: SketchMapEvent[], from: SketchMapState = initialSketchMapState()) => events.reduce(reduceSketchMap, from);

describe("reduceSketchMap", () => {
  it("loads, then is ready once the map has drawn", () => {
    expect(run([{ type: "loadStarted", loadId: 1 }])).toEqual({ phase: "loading", loadId: 1 });
    expect(run([{ type: "loadStarted", loadId: 1 }, { type: "mapReady", loadId: 1 }])).toEqual({ phase: "ready", loadId: 1 });
  });

  it("is unavailable without WebGL, and says why", () => {
    expect(run([{ type: "loadStarted", loadId: 1 }, { type: "mapFailed", loadId: 1, reason: "webgl" }])).toEqual({
      phase: "unavailable",
      loadId: 1,
      reason: "webgl",
    });
  });

  it("goes on with paper when tiles fail, and recovers when they come back", () => {
    const failing = run([{ type: "loadStarted", loadId: 1 }, { type: "mapReady", loadId: 1 }, { type: "tilesFailed", loadId: 1 }]);
    expect(failing).toEqual({ phase: "degraded", loadId: 1 });
    // The style drawing again is not the tiles coming back.
    expect(run([{ type: "mapReady", loadId: 1 }], failing)).toBe(failing);
    expect(run([{ type: "tilesLoaded", loadId: 1 }], failing)).toEqual({ phase: "ready", loadId: 1 });
  });

  it("is degraded at once when the tiles fail before the map has drawn", () => {
    const failing = run([{ type: "loadStarted", loadId: 1 }, { type: "tilesFailed", loadId: 1 }]);
    expect(failing).toEqual({ phase: "degraded", loadId: 1 });
    expect(run([{ type: "mapReady", loadId: 1 }], failing)).toBe(failing);
  });

  it("ignores events from an earlier load", () => {
    const loading = run([{ type: "loadStarted", loadId: 2 }]);
    expect(run([{ type: "mapReady", loadId: 1 }], loading)).toBe(loading);
    expect(run([{ type: "mapFailed", loadId: 1, reason: "style" }], loading)).toBe(loading);
  });

  it("goes back to idle when the map is taken down", () => {
    expect(run([{ type: "loadStarted", loadId: 1 }, { type: "disposed" }])).toEqual({ phase: "idle" });
  });
});

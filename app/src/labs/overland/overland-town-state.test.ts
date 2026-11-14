import { describe, expect, it } from "vitest";

import { initialOverlandTownState, reduceOverlandTown, townShowsFallback, type OverlandTownEvent, type OverlandTownState } from "@/labs/overland/overland-town-state";

function run(events: OverlandTownEvent[], from: OverlandTownState = initialOverlandTownState()) {
  return events.reduce(reduceOverlandTown, from);
}

describe("reduceOverlandTown", () => {
  it("starts idle, and a load mints a new load id", () => {
    expect(initialOverlandTownState()).toEqual({ phase: "idle", lastLoadId: 0 });
    expect(run([{ type: "loadStarted", tier: "high" }])).toEqual({ phase: "loading", loadId: 1, tier: "high" });
  });

  it("is ready once the renderer has drawn its first frame", () => {
    expect(run([{ type: "loadStarted", tier: "medium" }, { type: "rendererReady", loadId: 1 }])).toEqual({ phase: "ready", loadId: 1, tier: "medium" });
  });

  it("falls back to the pixel town when WebGL is missing or the chunk fails, keeping the reason", () => {
    for (const reason of ["webgl", "chunk", "error"] as const) {
      const state = run([{ type: "loadStarted", tier: "high" }, { type: "rendererFailed", loadId: 1, reason }]);
      expect(state).toEqual({ phase: "fallback", loadId: 1, reason });
      expect(townShowsFallback(state)).toBe(true);
    }
  });

  it("falls back when a ready town loses its WebGL context", () => {
    const state = run([{ type: "loadStarted", tier: "high" }, { type: "rendererReady", loadId: 1 }, { type: "contextLost", loadId: 1 }]);
    expect(state).toEqual({ phase: "fallback", loadId: 1, reason: "context" });
  });

  it("lowers the quality tier only while ready, and only downwards", () => {
    const ready = run([{ type: "loadStarted", tier: "high" }, { type: "rendererReady", loadId: 1 }]);
    expect(reduceOverlandTown(ready, { type: "qualityLowered", loadId: 1, tier: "medium" })).toEqual({ phase: "ready", loadId: 1, tier: "medium" });
    const medium = reduceOverlandTown(ready, { type: "qualityLowered", loadId: 1, tier: "medium" });
    expect(reduceOverlandTown(medium, { type: "qualityLowered", loadId: 1, tier: "high" })).toBe(medium);
    const loading = run([{ type: "loadStarted", tier: "high" }]);
    expect(reduceOverlandTown(loading, { type: "qualityLowered", loadId: 1, tier: "low" })).toBe(loading);
  });

  it("ignores an outcome from a superseded load", () => {
    const second = run([{ type: "loadStarted", tier: "high" }, { type: "disposed" }, { type: "loadStarted", tier: "high" }]);
    expect(second).toEqual({ phase: "loading", loadId: 2, tier: "high" });
    expect(reduceOverlandTown(second, { type: "rendererReady", loadId: 1 })).toBe(second);
    expect(reduceOverlandTown(second, { type: "rendererFailed", loadId: 1, reason: "webgl" })).toBe(second);
  });

  it("disposing returns to idle and remembers the last load", () => {
    const state = run([{ type: "loadStarted", tier: "high" }, { type: "rendererReady", loadId: 1 }, { type: "disposed" }]);
    expect(state).toEqual({ phase: "idle", lastLoadId: 1 });
    expect(reduceOverlandTown(state, { type: "rendererReady", loadId: 1 })).toBe(state);
  });

  it("a fallback is final for its load: a later ready does not bring the 3D town back", () => {
    const failed = run([{ type: "loadStarted", tier: "high" }, { type: "rendererFailed", loadId: 1, reason: "error" }]);
    expect(reduceOverlandTown(failed, { type: "rendererReady", loadId: 1 })).toBe(failed);
    expect(townShowsFallback(run([{ type: "loadStarted", tier: "high" }]))).toBe(false);
  });
});

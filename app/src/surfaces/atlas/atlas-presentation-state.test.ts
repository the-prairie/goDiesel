import { describe, expect, it } from "vitest";
import {
  initialAtlasPresentationState, isAtlasRegionPresented, reduceAtlasPresentation,
  type AtlasPresentationState,
} from "./atlas-presentation-state";
import type { AtlasWorldStatus } from "./atlas-world";

function mounted(regionName?: string) {
  return reduceAtlasPresentation(initialAtlasPresentationState(regionName), { type: "engineStarted", engineId: 1 });
}
function status(state: AtlasPresentationState, value: AtlasWorldStatus, engineId = 1) {
  return reduceAtlasPresentation(state, { type: "engineStatusReceived", engineId, status: value });
}
const ready = { state: "region-ready", regionName: "Kyoto", message: "Kyoto ready." } as const;

describe("Atlas presentation", () => {
  it("starts with no carousel globally and waits for an initial URL region", () => {
    expect(initialAtlasPresentationState().region).toEqual({ state: "none" });
    const selected = initialAtlasPresentationState("Kyoto");
    expect(selected.status).toEqual({ state: "loading", message: "Opening the Atlas world." });
    expect(isAtlasRegionPresented(selected, "Kyoto")).toBe(false);
  });

  it("reveals the selected region only after terrain is ready", () => {
    let state = mounted("Kyoto");
    state = status(state, { state: "region-loading", regionName: "Kyoto", message: "Loading." });
    expect(isAtlasRegionPresented(state, "Kyoto")).toBe(false);
    state = status(state, ready);
    expect(isAtlasRegionPresented(state, "Kyoto")).toBe(true);
    expect(isAtlasRegionPresented(state, "London")).toBe(false);
  });

  it("preserves ready presentation on same-region and route-only URL updates", () => {
    const state = status(mounted("Kyoto"), ready);
    expect(reduceAtlasPresentation(state, { type: "selectionChanged", regionName: "Kyoto" })).toBe(state);
  });

  it("waits for a newly selected region and clears presentation on global return", () => {
    let state = status(mounted("Kyoto"), ready);
    state = reduceAtlasPresentation(state, { type: "selectionChanged", regionName: "London" });
    expect(state.region).toEqual({ state: "waiting", regionName: "London" });
    expect(isAtlasRegionPresented(state, "Kyoto")).toBe(false);
    state = reduceAtlasPresentation(state, { type: "selectionChanged" });
    expect(state.region).toEqual({ state: "none" });
    expect(reduceAtlasPresentation(state, { type: "selectionChanged" })).toBe(state);
  });

  it("preserves carousel readiness for plain loading and fallback notifications", () => {
    let state = status(mounted("Kyoto"), ready);
    state = status(state, { state: "loading", message: "Opening again." });
    expect(isAtlasRegionPresented(state, "Kyoto")).toBe(true);
    state = status(state, { state: "region-fallback", regionName: "Kyoto", message: "Fallback." });
    expect(isAtlasRegionPresented(state, "Kyoto")).toBe(true);
  });

  it.each(["ready", "region-loading"] as const)("%s hides previously presented cards", stateName => {
    const state = status(status(mounted("Kyoto"), ready), {
      state: stateName, regionName: "Kyoto", message: "Loading.",
    });
    expect(isAtlasRegionPresented(state, "Kyoto")).toBe(false);
  });

  it("unavailable exposes the selected region while global unavailable has no carousel", () => {
    const unavailable = { state: "unavailable", message: "Provider failure." } as const;
    expect(isAtlasRegionPresented(status(mounted("Kyoto"), unavailable), "Kyoto")).toBe(true);
    expect(status(mounted(), unavailable).region).toEqual({ state: "none" });
  });

  it("waits for the matching fallback map before revealing its cards", () => {
    let state = status(mounted("Kyoto"), { state: "region-fallback", regionName: "Kyoto", message: "Fallback." });
    expect(isAtlasRegionPresented(state, "Kyoto")).toBe(false);
    state = reduceAtlasPresentation(state, { type: "fallbackReady", engineId: 1, regionName: "Kyoto" });
    expect(isAtlasRegionPresented(state, "Kyoto")).toBe(true);
    expect(reduceAtlasPresentation(state, { type: "fallbackReady", engineId: 1, regionName: "Kyoto" })).toBe(state);
  });

  it("ignores fallback readiness from another engine, region, or presentation stage", () => {
    const state = status(mounted("Kyoto"), { state: "region-fallback", regionName: "Kyoto", message: "Fallback." });
    expect(reduceAtlasPresentation(state, { type: "fallbackReady", engineId: 0, regionName: "Kyoto" })).toBe(state);
    expect(reduceAtlasPresentation(state, { type: "fallbackReady", engineId: 1, regionName: "London" })).toBe(state);
    const loading = mounted("Kyoto");
    expect(reduceAtlasPresentation(loading, { type: "fallbackReady", engineId: 1, regionName: "Kyoto" })).toBe(loading);
    const global = reduceAtlasPresentation(state, { type: "selectionChanged" });
    expect(reduceAtlasPresentation(global, { type: "fallbackReady", engineId: 1, regionName: "Kyoto" })).toBe(global);
  });

  it("rejects regional outcomes after a different URL selection", () => {
    const state = mounted("London");
    expect(status(state, ready)).toBe(state);
    const global = mounted();
    expect(status(global, ready)).toBe(global);
  });

  it("rejects old engine events after replacement and disposal", () => {
    let state = mounted("Kyoto");
    state = reduceAtlasPresentation(state, { type: "engineStarted", engineId: 2 });
    expect(status(state, ready)).toBe(state);
    expect(reduceAtlasPresentation(state, { type: "engineStopped", engineId: 1 })).toBe(state);
    state = status(state, ready, 2);
    expect(isAtlasRegionPresented(state, "Kyoto")).toBe(true);
    state = reduceAtlasPresentation(state, { type: "engineStopped", engineId: 2 });
    expect(status(state, { state: "unavailable", message: "Late failure." }, 2)).toBe(state);
  });

  it.each([
    ["a failure before the viewer", "This browser cannot start the Cesium world."],
    ["a failure after the viewer", "The Cesium world could not load."],
    ["a render error", "The Cesium world stopped rendering."],
  ])("presents a region selected after %s without waiting for terrain", (_name, message) => {
    const unavailable = { state: "unavailable", message } as const;
    for (const initial of [mounted(), status(mounted("Kyoto"), ready)]) {
      let state = status(initial, unavailable);
      state = reduceAtlasPresentation(state, { type: "selectionChanged", regionName: "London" });
      expect(state.status).toEqual(unavailable);
      expect(isAtlasRegionPresented(state, "London")).toBe(true);
      state = reduceAtlasPresentation(state, { type: "selectionChanged" });
      expect(state.region).toEqual({ state: "none" });
    }
  });

  it("still waits for terrain when the selection changes on a working world", () => {
    const state = reduceAtlasPresentation(status(mounted("Kyoto"), ready), {
      type: "selectionChanged", regionName: "London",
    });
    expect(state.region).toEqual({ state: "waiting", regionName: "London" });
  });

  // One rule: a selected region waits only while a working world is moving
  // to it. Route cards come from bundled data, so no network outcome (terrain,
  // the regional map) can hold them back, and the wait has a deadline.
  describe("never waits on the network for bundled route cards", () => {
    const fallback = { state: "region-fallback", regionName: "Kyoto", message: "Fallback." } as const;

    it("presents the region when its fallback map is unavailable", () => {
      let state = status(mounted("Kyoto"), fallback);
      state = reduceAtlasPresentation(state, { type: "fallbackUnavailable", engineId: 1, regionName: "Kyoto" });
      expect(isAtlasRegionPresented(state, "Kyoto")).toBe(true);
    });

    it("ignores an unavailable fallback map from another engine or region", () => {
      const state = status(mounted("Kyoto"), fallback);
      expect(reduceAtlasPresentation(state, { type: "fallbackUnavailable", engineId: 0, regionName: "Kyoto" })).toBe(state);
      expect(reduceAtlasPresentation(state, { type: "fallbackUnavailable", engineId: 1, regionName: "London" })).toBe(state);
    });

    it.each([
      ["the world is still opening", (state: AtlasPresentationState) => state],
      ["terrain is loading", (state: AtlasPresentationState) =>
        status(state, { state: "region-loading", regionName: "Kyoto", message: "Loading." })],
      ["the fallback map is loading", (state: AtlasPresentationState) => status(state, fallback)],
    ])("presents a waiting region at its deadline while %s", (_name, advance) => {
      let state = advance(mounted("Kyoto"));
      expect(isAtlasRegionPresented(state, "Kyoto")).toBe(false);
      state = reduceAtlasPresentation(state, { type: "presentationDeadlinePassed", regionName: "Kyoto" });
      expect(isAtlasRegionPresented(state, "Kyoto")).toBe(true);
    });

    it("keeps cards shown at the deadline when the world catches up behind them", () => {
      let state = reduceAtlasPresentation(mounted("Kyoto"), { type: "presentationDeadlinePassed", regionName: "Kyoto" });
      for (const next of [
        { state: "region-loading", regionName: "Kyoto", message: "Loading." },
        { state: "region-fallback", regionName: "Kyoto", message: "Fallback." },
        { state: "region-ready", regionName: "Kyoto", message: "Ready." },
      ] as const) {
        state = status(state, next);
        expect(isAtlasRegionPresented(state, "Kyoto")).toBe(true);
      }
    });

    it("ignores a deadline for a region that is no longer waiting", () => {
      const waiting = mounted("London");
      expect(reduceAtlasPresentation(waiting, { type: "presentationDeadlinePassed", regionName: "Kyoto" })).toBe(waiting);
      const presented = status(mounted("Kyoto"), ready);
      expect(reduceAtlasPresentation(presented, { type: "presentationDeadlinePassed", regionName: "Kyoto" })).toBe(presented);
      const global = mounted();
      expect(reduceAtlasPresentation(global, { type: "presentationDeadlinePassed", regionName: "Kyoto" })).toBe(global);
    });
  });

  describe("world opening", () => {
    it("is opening until a world first shows the globe or a region", () => {
      expect(mounted().world).toBe("opening");
      expect(status(mounted(), { state: "loading", message: "Opening." }).world).toBe("opening");
      expect(status(mounted(), { state: "unavailable", message: "Failed." }).world).toBe("opening");
      expect(status(mounted(), { state: "ready", message: "Ready." }).world).toBe("open");
      expect(status(mounted("Kyoto"), ready).world).toBe("open");
    });

    it("stays open through later loading and a replacement engine", () => {
      let state = status(mounted(), { state: "ready", message: "Ready." });
      state = status(state, { state: "loading", message: "Returning." });
      state = reduceAtlasPresentation(state, { type: "engineStarted", engineId: 2 });
      expect(state.world).toBe("open");
    });
  });
});

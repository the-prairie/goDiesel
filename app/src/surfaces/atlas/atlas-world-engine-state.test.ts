import { describe, expect, it } from "vitest";

import {
  atlasCameraPoseIntent,
  atlasCameraState,
  atlasEngineDataset,
  atlasEngineHasViewer,
  atlasEngineRunIsCurrent,
  atlasGlobeIsSettled,
  atlasRegionIsCurrent,
  initialAtlasWorldEngineState,
  reduceAtlasWorldEngine,
  type AtlasWorldEngineEvent,
  type AtlasWorldEngineState,
} from "@/surfaces/atlas/atlas-world-engine-state";

function run(events: AtlasWorldEngineEvent[], from = initialAtlasWorldEngineState()) {
  return events.reduce(reduceAtlasWorldEngine, from);
}

const attached: AtlasWorldEngineEvent[] = [
  { type: "mountStarted", routeCount: 66 },
  { type: "viewerAttached", operationId: 1 },
];
const mounted: AtlasWorldEngineEvent[] = [
  ...attached,
  { type: "globalViewRequested", durationMs: 600 },
  { type: "globalFlightSettled", flightId: 1 },
  { type: "mountSettled", operationId: 1 },
];
const kyoto: AtlasWorldEngineEvent = { type: "regionSelected", regionName: "Kyoto", routeCount: 2 };

function announced(states: AtlasWorldEngineState[]) {
  return states.flatMap((state, index) =>
    index > 0 && state.statusRevision !== states[index - 1].statusRevision
      ? [state.status]
      : []);
}

function trace(events: AtlasWorldEngineEvent[]) {
  const states = [initialAtlasWorldEngineState()];
  for (const event of events) states.push(reduceAtlasWorldEngine(states.at(-1)!, event));
  return states;
}

describe("Atlas world engine state", () => {
  it("allocates one run identity and announces each mount outcome", () => {
    const states = trace(mounted);
    const state = states.at(-1)!;
    expect(state.operationId).toBe(1);
    expect(state.mount).toEqual({ phase: "ready" });
    expect(announced(states)).toEqual([
      { state: "loading", message: "Opening the Atlas world." },
      { state: "ready", message: "Atlas world ready." },
    ]);
    expect(atlasEngineHasViewer(state)).toBe(true);
  });

  it.each([
    ["webglUnavailable", "webgl", false, "This browser cannot start the Cesium world."],
    ["mountFailed", "mount", false, "The Cesium world could not load."],
  ] as const)("names %s before the viewer exists", (type, reason, viewer, message) => {
    const state = run([{ type: "mountStarted", routeCount: 1 }, { type, operationId: 1 }]);
    expect(state.mount).toEqual({ phase: "unavailable", reason, viewer });
    expect(state.status).toEqual({ state: "unavailable", message });
    expect(atlasEngineHasViewer(state)).toBe(false);
  });

  it("keeps the viewer when mount fails after it exists", () => {
    const state = run([...attached, { type: "mountFailed", operationId: 1 }]);
    expect(state.mount).toEqual({ phase: "unavailable", reason: "mount", viewer: true });
  });

  it("suppresses mount readiness after a render error and announces every render error", () => {
    const states = trace([
      ...attached,
      { type: "renderFailed", operationId: 1 },
      { type: "renderFailed", operationId: 1 },
      { type: "mountSettled", operationId: 1 },
    ]);
    expect(states.at(-1)!.mount).toEqual({ phase: "unavailable", reason: "render", viewer: true });
    expect(announced(states).map((status) => status?.message)).toEqual([
      "Opening the Atlas world.",
      "The Cesium world stopped rendering.",
      "The Cesium world stopped rendering.",
    ]);
  });

  it("becomes ready without announcing when a region was selected during mount", () => {
    const before = run([...attached, kyoto]);
    const state = reduceAtlasWorldEngine(before, { type: "mountSettled", operationId: 1 });
    expect(state.mount.phase).toBe("ready");
    expect(state.statusRevision).toBe(before.statusRevision);
  });

  it("rejects outcomes from a disposed or replaced run", () => {
    const disposed = run([...attached, { type: "disposed" }]);
    expect(atlasEngineRunIsCurrent(disposed, 1)).toBe(false);
    for (const type of ["webglUnavailable", "viewerAttached", "mountFailed", "renderFailed", "mountSettled"] as const) {
      expect(reduceAtlasWorldEngine(disposed, { type, operationId: 1 })).toBe(disposed);
    }
    const replaced = run([...attached, { type: "mountStarted", routeCount: 66 }]);
    expect(replaced.operationId).toBe(2);
    expect(reduceAtlasWorldEngine(replaced, { type: "renderFailed", operationId: 1 })).toBe(replaced);
  });

  it("derives every disposal latch from one disposed transition", () => {
    const flying = run([...mounted, { type: "globalViewRequested", durationMs: 600 }]);
    const disposed = reduceAtlasWorldEngine(flying, { type: "disposed" });
    expect(disposed.mount).toEqual({ phase: "disposed" });
    expect(disposed.regional.status).toBe("disposed");
    expect(disposed.camera).toEqual({ state: "settled", flightId: 3 });
    expect(atlasEngineHasViewer(disposed)).toBe(false);
    expect(reduceAtlasWorldEngine(disposed, { type: "globalFlightSettled", flightId: 2 })).toBe(disposed);
    for (const event of [kyoto, { type: "selectionCleared", durationMs: 600 }, { type: "globalViewRequested", durationMs: 600 }] as const) {
      expect(reduceAtlasWorldEngine(disposed, event)).toBe(disposed);
    }
  });

  it("shares an active global flight and settles only the latest one", () => {
    const flying = run([...attached, { type: "globalViewRequested", durationMs: 600 }]);
    expect(flying.camera).toEqual({ state: "flying", flightId: 1, durationMs: 600 });
    expect(reduceAtlasWorldEngine(flying, { type: "globalViewRequested", durationMs: 0 })).toBe(flying);
    const superseded = reduceAtlasWorldEngine(flying, kyoto);
    expect(superseded.camera).toEqual({ state: "settled", flightId: 2 });
    expect(reduceAtlasWorldEngine(superseded, { type: "globalFlightSettled", flightId: 1 })).toBe(superseded);
  });

  it("returns to the globe with a ready announcement only when already settled", () => {
    const settled = run(mounted);
    expect(atlasGlobeIsSettled(settled)).toBe(true);
    const again = reduceAtlasWorldEngine(settled, { type: "selectionCleared", durationMs: 600 });
    expect(again.status).toEqual({ state: "ready", message: "Atlas world ready." });
    expect(again.camera.state).toBe("settled");

    const fromRegion = run([...mounted, kyoto, { type: "selectionCleared", durationMs: 600 }]);
    expect(fromRegion.status).toEqual({ state: "loading", message: "Opening the Atlas world." });
    expect(fromRegion.camera).toEqual({ state: "flying", flightId: 3, durationMs: 600 });
    const restoredFor = (regionalOperationId: number) =>
      reduceAtlasWorldEngine(fromRegion, { type: "globalViewRestored", regionalOperationId });
    expect(restoredFor(1)).toBe(fromRegion);
    expect(restoredFor(2).status).toEqual({ state: "ready", message: "Atlas world ready." });
  });

  it("composes regional outcomes and announces only status changes", () => {
    const loading = run([...mounted, kyoto]);
    expect(loading.status).toEqual({ state: "region-loading", regionName: "Kyoto", message: "Loading Kyoto terrain" });
    const tile = reduceAtlasWorldEngine(loading, {
      type: "regionalOutcome", event: { type: "tileFailed", operationId: 1, atMs: 0 },
    });
    expect(tile.statusRevision).toBe(loading.statusRevision);
    const ready = reduceAtlasWorldEngine(tile, {
      type: "regionalOutcome", event: { type: "transitionSettled", operationId: 1, terrainReady: true },
    });
    expect(ready.status).toEqual({ state: "region-ready", regionName: "Kyoto", message: "Kyoto terrain ready." });
    const fallback = reduceAtlasWorldEngine(ready, {
      type: "regionalOutcome", event: { type: "terrainFailed", operationId: 1 },
    });
    expect(fallback.status).toEqual({ state: "region-fallback", regionName: "Kyoto", message: "3D terrain partially unavailable" });
    expect(reduceAtlasWorldEngine(fallback, {
      type: "regionalOutcome", event: { type: "terrainFailed", operationId: 1 },
    })).toBe(fallback);
    expect(atlasRegionIsCurrent(ready, 1)).toBe(true);
    expect(atlasRegionIsCurrent(fallback, 1)).toBe(false);
  });

  it("projects the canvas dataset from state alone", () => {
    const initial = run(attached);
    expect(atlasEngineDataset(initial)).toEqual({
      atlasEngine: "cesium", heatLines: "66", routePalette: "monochrome",
      atlasState: "global", cameraState: "settled", terrainState: "global",
      regionRouteCount: "0", regionCameraRange: "", regionSphereRadius: "", regionCameraPitch: "",
    });
    const framed = run([...mounted, kyoto, {
      type: "regionFramed", regionalOperationId: 1, durationMs: 1150,
      framing: { rangeM: 28_000.4, sphereRadiusM: 9_000.6, pitchRadians: -1.02 },
    }]);
    expect(atlasEngineDataset(framed)).toMatchObject({
      atlasState: "region-loading", cameraState: "transitioning", terrainState: "loading",
      regionRouteCount: "2", cameraRegion: "Kyoto", cameraDurationMs: "1150",
      regionCameraRange: "28000", regionSphereRadius: "9001", regionCameraPitch: "-1.02",
    });
  });

  it("settles the camera dataset immediately for a zero-length flight", () => {
    const state = run([...attached, { type: "globalViewRequested", durationMs: 0 }]);
    expect(state.camera.state).toBe("flying");
    expect(atlasCameraState(state)).toBe("settled");
    expect(atlasCameraState(run([...attached, { type: "globalViewRequested", durationMs: 600 }]))).toBe("transitioning");
  });

  it("keeps the last selected-route attribute when the globe return clears styling", () => {
    const before = run([{ type: "routeSelected", slug: "early" }]);
    expect(before.routeSlug).toBe("early");
    expect(before.selectedRouteAttribute).toBeUndefined();
    const selected = run([...mounted, kyoto, { type: "routeSelected", slug: "a" }]);
    const cleared = reduceAtlasWorldEngine(selected, { type: "selectionCleared", durationMs: 600 });
    expect(cleared.routeSlug).toBeUndefined();
    expect(atlasEngineDataset(cleared).selectedRoute).toBe("a");
    expect(atlasEngineDataset(reduceAtlasWorldEngine(cleared, { type: "routeSelected" })).selectedRoute).toBe("");
  });

  it("commits the camera pose on global flight start and settlement and on framing", () => {
    const global = { cameraTarget: "18500000", cameraHeading: "0.000000", cameraPitch: (-Math.PI / 2).toFixed(6) };
    const before = run(attached);
    const flying = reduceAtlasWorldEngine(before, { type: "globalViewRequested", durationMs: 600 });
    expect(atlasCameraPoseIntent(before, flying)).toEqual(global);
    const settled = reduceAtlasWorldEngine(flying, { type: "globalFlightSettled", flightId: 1 });
    expect(atlasCameraPoseIntent(flying, settled)).toEqual(global);
    const superseded = reduceAtlasWorldEngine(flying, kyoto);
    expect(atlasCameraPoseIntent(flying, superseded)).toBeUndefined();
    const framed = reduceAtlasWorldEngine(superseded, {
      type: "regionFramed", regionalOperationId: 1, durationMs: 120,
      framing: { rangeM: 42_000, sphereRadiusM: 1, pitchRadians: -1.02 },
    });
    expect(atlasCameraPoseIntent(superseded, framed)).toEqual({ cameraTarget: "42000" });
  });
});

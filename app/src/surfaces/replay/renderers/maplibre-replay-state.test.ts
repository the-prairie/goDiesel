import { describe, expect, it } from "vitest";
import {
  initialMapLibreReplayState,
  mapLibreFollowsPose,
  mapLibreReplayStatus,
  mapLibreRunIsCurrent,
  reduceMapLibreReplay as reduce,
  type MapLibreReplayState,
} from "./maplibre-replay-state";

const start = (state: MapLibreReplayState = initialMapLibreReplayState()) =>
  reduce(state, { type: "mapStarted" });
const error = (state: MapLibreReplayState) =>
  reduce(state, { type: "mapError", operationId: state.operationId });
const LOADING = {
  state: "loading",
  title: "Opening Atlas replay",
  message: "Loading the route map and replay thread.",
};
const GEOMETRY = {
  state: "unavailable",
  title: "Route geometry unavailable",
  message: "This route does not contain enough points for Atlas replay.",
};

describe("MapLibre Replay lifecycle", () => {
  it("ignores provider outcomes before a map is started", () => {
    const state = initialMapLibreReplayState();
    expect(mapLibreReplayStatus(state)).toBeUndefined();
    for (const type of [
      "mapError",
      "mapLoaded",
      "deadlineReached",
      "inputsRejected",
    ] as const) {
      expect(reduce(state, { type, operationId: 0 })).toBe(state);
    }
  });

  it("waits through three errors and reports the fourth", () => {
    let state = start();
    for (let i = 0; i < 3; i++) state = error(state);
    expect(state).toMatchObject({ phase: "loading", errorCount: 3 });
    state = error(state);
    expect(state).toMatchObject({
      phase: "unavailable",
      reason: "errors",
      errorCount: 4,
    });
    expect(mapLibreReplayStatus(state)?.title).toBe("Atlas replay unavailable");
    expect(error(state)).toMatchObject({
      phase: "unavailable",
      reason: "errors",
      errorCount: 4,
    });
  });

  it("allows the deadline after errors and errors after the deadline", () => {
    let state = start();
    for (let i = 0; i < 4; i++) state = error(state);
    state = reduce(state, { type: "deadlineReached", operationId: 1 });
    expect(mapLibreReplayStatus(state)?.title).toBe("Atlas replay timed out");
    expect(mapLibreReplayStatus(error(state))?.title).toBe(
      "Atlas replay unavailable",
    );
  });

  it.each(["errors", "deadline"] as const)(
    "recovers from %s on late load",
    (reason) => {
      let state = start();
      if (reason === "errors") for (let i = 0; i < 4; i++) state = error(state);
      else state = reduce(state, { type: "deadlineReached", operationId: 1 });
      const ready = reduce(state, { type: "mapLoaded", operationId: 1 });
      expect(ready.phase).toBe("ready");
      expect(mapLibreReplayStatus(ready)?.title).toBe("Atlas replay ready");
    },
  );

  it("keeps readiness through errors and the deadline", () => {
    let state = reduce(start(), { type: "mapLoaded", operationId: 1 });
    for (let i = 0; i < 8; i++) state = error(state);
    expect(state.phase).toBe("ready");
    expect(reduce(state, { type: "deadlineReached", operationId: 1 })).toBe(
      state,
    );
  });

  it("rejects retired operation outcomes", () => {
    const state = start(start());
    expect(state.operationId).toBe(2);
    for (const type of [
      "mapError",
      "mapLoaded",
      "deadlineReached",
      "inputsRejected",
    ] as const) {
      expect(reduce(state, { type, operationId: 1 })).toBe(state);
    }
  });

  it("disposes pending work and resets errors for a subsequent mount", () => {
    const disposed = reduce(error(start()), { type: "disposed" });
    expect(mapLibreReplayStatus(disposed)).toBeUndefined();
    for (const type of [
      "mapError",
      "mapLoaded",
      "deadlineReached",
      "inputsRejected",
    ] as const) {
      expect(reduce(disposed, { type, operationId: 1 })).toBe(disposed);
    }
    expect(start(disposed)).toMatchObject({
      phase: "loading",
      operationId: 2,
      errorCount: 0,
    });
  });

  it("retains existing readiness and error budget if mounted again without disposal", () => {
    const errored = error(start());
    expect(start(errored)).toMatchObject({ phase: "loading", errorCount: 1 });
    const ready = reduce(errored, { type: "mapLoaded", operationId: 1 });
    expect(start(ready)).toMatchObject({
      phase: "ready",
      carriedOver: true,
      errorCount: 1,
    });
  });
});

describe("MapLibre run identity and status", () => {
  it("allocates one increasing operation id per map", () => {
    const first = start();
    const second = start(reduce(first, { type: "disposed" }));
    expect([first.operationId, second.operationId]).toEqual([1, 2]);
  });

  it("treats only the live map as current", () => {
    const loading = start();
    expect(mapLibreRunIsCurrent(loading, 1)).toBe(true);
    expect(mapLibreRunIsCurrent(start(loading), 1)).toBe(false);
    expect(
      mapLibreRunIsCurrent(reduce(loading, { type: "disposed" }), 1),
    ).toBe(false);
    for (let i = 0, state = loading; i < 4; i++) {
      state = error(state);
      expect(mapLibreRunIsCurrent(state, 1)).toBe(true);
    }
  });

  it("announces loading for every map, including one that inherits readiness", () => {
    const loading = start();
    const ready = reduce(loading, { type: "mapLoaded", operationId: 1 });
    const carried = start(ready);
    expect(mapLibreReplayStatus(loading)).toEqual(LOADING);
    expect(mapLibreReplayStatus(carried)).toEqual(LOADING);
    expect(carried.statusRevision).toBe(ready.statusRevision + 1);
    const loaded = reduce(carried, { type: "mapLoaded", operationId: 2 });
    expect(loaded).toMatchObject({ phase: "ready", carriedOver: false });
    expect(loaded.statusRevision).toBe(carried.statusRevision + 1);
  });

  it("rejects insufficient geometry as unavailable", () => {
    const loading = start();
    const state = reduce(loading, { type: "inputsRejected", operationId: 1 });
    expect(state).toMatchObject({
      phase: "unavailable",
      reason: "geometry",
      previousMapReady: false,
    });
    expect(state.statusRevision).toBe(loading.statusRevision + 1);
    expect(mapLibreReplayStatus(state)).toEqual(GEOMETRY);
    expect(mapLibreFollowsPose(state)).toBe(false);
    for (const type of ["mapError", "mapLoaded", "deadlineReached"] as const)
      expect(reduce(state, { type, operationId: 1 })).toBe(state);
    expect(start(state)).toMatchObject({ phase: "loading", operationId: 2 });
  });

  it("keeps a previously ready map following through rejected geometry", () => {
    const ready = reduce(start(), { type: "mapLoaded", operationId: 1 });
    const rejected = reduce(start(ready), {
      type: "inputsRejected",
      operationId: 2,
    });
    expect(rejected).toMatchObject({
      phase: "unavailable",
      reason: "geometry",
      previousMapReady: true,
    });
    expect(mapLibreReplayStatus(rejected)).toEqual(GEOMETRY);
    expect(mapLibreFollowsPose(rejected)).toBe(true);
    expect(start(rejected)).toMatchObject({
      phase: "ready",
      carriedOver: true,
      operationId: 3,
    });
  });

  it("ignores rejected geometry once a map has an outcome", () => {
    const ready = reduce(start(), { type: "mapLoaded", operationId: 1 });
    expect(reduce(ready, { type: "inputsRejected", operationId: 1 })).toBe(
      ready,
    );
  });

  it("announces each error outcome but not errors below the budget or after readiness", () => {
    let state = start();
    const initial = state.statusRevision;
    for (let i = 0; i < 3; i++) state = error(state);
    expect(state.statusRevision).toBe(initial);
    state = error(state);
    expect(state.statusRevision).toBe(initial + 1);
    state = error(state);
    expect(state.statusRevision).toBe(initial + 2);
    const ready = reduce(state, { type: "mapLoaded", operationId: 1 });
    expect(error(ready).statusRevision).toBe(ready.statusRevision);
  });

  it("does not announce errors below the budget after a timeout", () => {
    const timedOut = reduce(start(), {
      type: "deadlineReached",
      operationId: 1,
    });
    const errored = error(timedOut);
    expect(errored).toMatchObject({ phase: "unavailable", reason: "deadline" });
    expect(errored.statusRevision).toBe(timedOut.statusRevision);
  });

  it.each([
    ["while loading", () => start()],
    ["over a ready map carried into a new mount", () =>
      start(reduce(start(), { type: "mapLoaded", operationId: 1 }))],
  ])("reports a map that cannot be constructed %s at once and for good", (_label, begin) => {
    const before = begin();
    const state = reduce(before, {
      type: "mapUnsupported",
      operationId: before.operationId,
    });
    expect(state).toMatchObject({ phase: "unavailable", reason: "unsupported" });
    expect(state.statusRevision).toBe(before.statusRevision + 1);
    expect(mapLibreReplayStatus(state)).toEqual({
      state: "unavailable",
      title: "Atlas replay isn\u2019t supported here",
      message:
        "This browser couldn\u2019t start the map graphics (WebGL 2) that Atlas replay draws on.",
    });
    expect(mapLibreFollowsPose(state)).toBe(false);
    for (const type of ["mapError", "mapLoaded", "deadlineReached", "inputsRejected"] as const)
      expect(reduce(state, { type, operationId: before.operationId })).toBe(state);
    expect(start(state)).toMatchObject({ phase: "loading", operationId: before.operationId + 1 });
  });

  it("follows the pose only while a map is ready", () => {
    const loading = start();
    expect(mapLibreFollowsPose(loading)).toBe(false);
    const ready = reduce(loading, { type: "mapLoaded", operationId: 1 });
    expect(mapLibreFollowsPose(ready)).toBe(true);
    expect(mapLibreFollowsPose(start(ready))).toBe(true);
    expect(mapLibreFollowsPose(reduce(ready, { type: "disposed" }))).toBe(
      false,
    );
  });
});

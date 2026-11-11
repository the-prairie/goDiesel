import { describe, expect, it } from "vitest";
import {
  cesiumFidelityStatus,
  cesiumRunIsCurrent,
  initialCesiumFidelityState,
  reduceCesiumFidelity,
  type CesiumFidelityEvent,
  type CesiumFidelityState,
} from "./cesium-fidelity-state";

const reduce = reduceCesiumFidelity;
const start = (state = initialCesiumFidelityState()) =>
  reduce(state, { type: "sessionStarted" });
const ready = () =>
  reduce(start(), {
    type: "initialTilesSettled",
    operationId: 1,
    result: "loaded",
  });
function fail(state: CesiumFidelityState, count: number, atMs = 0) {
  for (let i = 0; i < count; i++)
    state = reduce(state, {
      type: "tileFailed",
      operationId: state.operationId,
      atMs,
    });
  return state;
}
const LOADING = {
  state: "loading",
  title: "Building your route world",
  message: "Loading the bundled Earth engine and photorealistic tiles.",
};

describe("Cesium fidelity transitions", () => {
  it.each(["loaded", "timeout"] as const)(
    "permits playback after %s initialization",
    (result) => {
      const state = reduce(start(), {
        type: "initialTilesSettled",
        operationId: 1,
        result,
      });
      expect(state).toMatchObject({ phase: "ready", initialTiles: result });
      expect(cesiumFidelityStatus(state)?.state).toBe("ready");
    },
  );
  it("does not treat cancellation as readiness", () => {
    const state = start();
    expect(
      reduce(state, {
        type: "initialTilesSettled",
        operationId: 1,
        result: "cancelled",
      }),
    ).toBe(state);
  });
  it("includes failures exactly fifteen seconds old at the threshold", () => {
    const state = fail(start(), 7);
    expect(state.phase).toBe("loading");
    expect(fail(state, 1, 15000)).toMatchObject({
      phase: "partial",
      reason: "tileFailures",
    });
    expect(fail(state, 1, 15001)).toMatchObject({
      phase: "loading",
      tileFailureTimes: [15001],
    });
  });
  it("keeps the first degradation sticky through later readiness and observations", () => {
    const state = fail(start(), 8);
    expect(
      reduce(state, {
        type: "initialTilesSettled",
        operationId: 1,
        result: "loaded",
      }),
    ).toBe(state);
    expect(
      reduce(state, {
        type: "frameObserved",
        operationId: 1,
        blank: false,
      }),
    ).toBe(state);
    expect(fail(state, 1)).toBe(state);
    expect(cesiumFidelityStatus(state)?.message).toContain(
      "Several photorealistic tiles",
    );
  });
  it("resets consecutive blank observations after visible frames", () => {
    let state = ready();
    for (const blank of [true, false, true])
      state = reduce(state, {
        type: "frameObserved",
        operationId: 1,
        blank,
      });
    expect(state.phase).toBe("ready");
    state = reduce(state, {
      type: "frameObserved",
      operationId: 1,
      blank: true,
    });
    expect(state).toMatchObject({ phase: "partial", reason: "blankFrames" });
  });
  it("ignores diagnostics before ready and all stale outcomes", () => {
    const state = start(start());
    expect(state.operationId).toBe(2);
    const stale: CesiumFidelityEvent[] = [
      { type: "frameObserved", operationId: 2, blank: true },
      { type: "tileFailed", operationId: 1, atMs: 0 },
      { type: "initialTilesSettled", operationId: 1, result: "timeout" },
      { type: "inputsRejected", operationId: 1, reason: "geometry" },
      { type: "loadFailed", operationId: 1 },
    ];
    for (const event of stale) expect(reduce(state, event)).toBe(state);
  });
  it("clears health on disposal and rejects late outcomes before a fresh session", () => {
    const state = reduce(fail(ready(), 8), { type: "disposed" });
    expect(state).toMatchObject({
      phase: "disposed",
      operationId: 1,
      tileFailureTimes: [],
      blankFrameCount: 0,
    });
    expect(cesiumFidelityStatus(state)).toBeUndefined();
    for (const event of [
      { type: "initialTilesSettled", operationId: 1, result: "loaded" },
      { type: "inputsRejected", operationId: 1, reason: "webgl" },
      { type: "loadFailed", operationId: 1 },
    ] as const)
      expect(reduce(state, event)).toBe(state);
    expect(start(state)).toMatchObject({
      phase: "loading",
      operationId: 2,
      tileFailureTimes: [],
    });
  });
  it("preserves sticky health if reused without disposal", () => {
    const state = fail(start(), 8);
    expect(start(state)).toMatchObject({
      phase: "partial",
      reason: "tileFailures",
      operationId: 2,
    });
  });
});

describe("Cesium run identity", () => {
  it("allocates one increasing operation id per session", () => {
    const first = start();
    const second = start(reduce(first, { type: "disposed" }));
    expect([first.operationId, second.operationId]).toEqual([1, 2]);
  });
  it("treats only the live session as current", () => {
    const loading = start();
    expect(cesiumRunIsCurrent(loading, 1)).toBe(true);
    expect(cesiumRunIsCurrent(start(loading), 1)).toBe(false);
    expect(cesiumRunIsCurrent(ready(), 1)).toBe(true);
    expect(cesiumRunIsCurrent(fail(start(), 8), 1)).toBe(true);
    expect(cesiumRunIsCurrent(reduce(loading, { type: "disposed" }), 1)).toBe(
      false,
    );
    expect(
      cesiumRunIsCurrent(
        reduce(loading, { type: "loadFailed", operationId: 1 }),
        1,
      ),
    ).toBe(false);
  });
  it("keeps a run with rejected inputs current because it released nothing", () => {
    const rejected = reduce(start(), {
      type: "inputsRejected",
      operationId: 1,
      reason: "credentials",
    });
    expect(cesiumRunIsCurrent(rejected, 1)).toBe(true);
  });
  it("treats an unmounted engine as its own current run", () => {
    expect(cesiumRunIsCurrent(initialCesiumFidelityState(), 0)).toBe(true);
  });
});

describe("Cesium engine status", () => {
  it("announces loading for every session", () => {
    const first = start();
    const again = start(first);
    expect(cesiumFidelityStatus(first)).toEqual(LOADING);
    expect(cesiumFidelityStatus(again)).toEqual(LOADING);
    expect(again.statusRevision).toBe(first.statusRevision + 1);
  });
  it.each([
    [
      "geometry",
      "Route geometry unavailable",
      "This completed route does not contain enough points to replay.",
    ],
    [
      "webgl",
      "WebGL unavailable",
      "This browser cannot start the photorealistic replay.",
    ],
    [
      "credentials",
      "Map tiles unavailable",
      "A Google Map Tiles browser key is required for Earth Replay.",
    ],
  ] as const)("rejects %s inputs as unavailable", (reason, title, message) => {
    const loading = start();
    const state = reduce(loading, {
      type: "inputsRejected",
      operationId: 1,
      reason,
    });
    expect(state).toMatchObject({ phase: "unavailable", reason });
    expect(state.statusRevision).toBe(loading.statusRevision + 1);
    expect(cesiumFidelityStatus(state)).toEqual({
      state: "unavailable",
      title,
      message,
    });
  });
  it("ignores rejected inputs once a session has settled", () => {
    const state = ready();
    expect(
      reduce(state, {
        type: "inputsRejected",
        operationId: 1,
        reason: "geometry",
      }),
    ).toBe(state);
  });
  it.each([
    ["loading", () => fail(start(), 3)],
    ["ready", () => fail(ready(), 3)],
    ["partial", () => fail(start(), 8)],
  ])("fails a load from %s and clears its health", (_phase, from) => {
    const before = from();
    const state = reduce(before, { type: "loadFailed", operationId: 1 });
    expect(state).toMatchObject({
      phase: "unavailable",
      reason: "provider",
      tileFailureTimes: [],
      blankFrameCount: 0,
    });
    expect(state.statusRevision).toBe(before.statusRevision + 1);
    expect(cesiumFidelityStatus(state)).toEqual({
      state: "unavailable",
      title: "Photorealistic world unavailable",
      message: "Google 3D tiles could not load for this route.",
    });
  });
  it("ignores fidelity outcomes and repeated failures once unavailable", () => {
    const state = reduce(start(), { type: "loadFailed", operationId: 1 });
    for (const event of [
      { type: "initialTilesSettled", operationId: 1, result: "loaded" },
      { type: "tileFailed", operationId: 1, atMs: 0 },
      { type: "frameObserved", operationId: 1, blank: true },
      { type: "loadFailed", operationId: 1 },
      { type: "inputsRejected", operationId: 1, reason: "geometry" },
    ] as const)
      expect(reduce(state, event)).toBe(state);
  });
  it("announces only fidelity changes of phase", () => {
    const loading = start();
    const failing = fail(loading, 7);
    expect(failing.statusRevision).toBe(loading.statusRevision);
    const partial = fail(failing, 1);
    expect(partial.statusRevision).toBe(loading.statusRevision + 1);
    const settled = ready();
    expect(settled.statusRevision).toBe(loading.statusRevision + 1);
    const visible = reduce(settled, {
      type: "frameObserved",
      operationId: 1,
      blank: true,
    });
    expect(visible.statusRevision).toBe(settled.statusRevision);
    expect(reduce(settled, { type: "disposed" }).statusRevision).toBe(
      settled.statusRevision,
    );
  });
  it("announces loading, not partial, for a session that inherits partial fidelity", () => {
    const partial = fail(start(), 8);
    const carried = start(partial);
    expect(carried).toMatchObject({ phase: "partial", carriedOver: true });
    expect(carried.statusRevision).toBe(partial.statusRevision + 1);
    expect(cesiumFidelityStatus(carried)).toEqual(LOADING);
    expect(
      reduce(carried, {
        type: "initialTilesSettled",
        operationId: 2,
        result: "loaded",
      }),
    ).toBe(carried);
    expect(start(carried)).toMatchObject({
      phase: "partial",
      carriedOver: true,
      operationId: 3,
    });
  });
  it("retains inherited partial fidelity through rejected inputs", () => {
    const carried = start(fail(start(), 8));
    const rejected = reduce(carried, {
      type: "inputsRejected",
      operationId: 2,
      reason: "geometry",
    });
    expect(rejected).toMatchObject({
      phase: "unavailable",
      reason: "geometry",
      retainedPartial: "tileFailures",
    });
    expect(start(rejected)).toMatchObject({
      phase: "partial",
      reason: "tileFailures",
      carriedOver: true,
      operationId: 3,
    });
  });
  it("starts a fresh load after an unavailable session without retained fidelity", () => {
    const rejected = reduce(fail(start(), 3), {
      type: "inputsRejected",
      operationId: 1,
      reason: "webgl",
    });
    expect(start(rejected)).toMatchObject({
      phase: "loading",
      operationId: 2,
      tileFailureTimes: [0, 0, 0],
    });
  });
});

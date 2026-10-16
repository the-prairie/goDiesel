import { describe, expect, it } from "vitest";
import {
  cesiumFidelityStatus,
  initialCesiumFidelityState,
  reduceCesiumFidelity,
  type CesiumFidelityState,
} from "./cesium-fidelity-state";
const start = (operationId = 1) =>
  reduceCesiumFidelity(initialCesiumFidelityState(), {
    type: "sessionStarted",
    operationId,
  });
const ready = () =>
  reduceCesiumFidelity(start(), {
    type: "initialTilesSettled",
    operationId: 1,
    result: "loaded",
  });
function fail(state: CesiumFidelityState, count: number, atMs = 0) {
  for (let i = 0; i < count; i++)
    state = reduceCesiumFidelity(state, {
      type: "tileFailed",
      operationId: state.operationId,
      atMs,
    });
  return state;
}
describe("Cesium fidelity transitions", () => {
  it.each(["loaded", "timeout"] as const)(
    "permits playback after %s initialization",
    (result) => {
      const state = reduceCesiumFidelity(start(), {
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
      reduceCesiumFidelity(state, {
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
      reduceCesiumFidelity(state, {
        type: "initialTilesSettled",
        operationId: 1,
        result: "loaded",
      }),
    ).toBe(state);
    expect(
      reduceCesiumFidelity(state, {
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
      state = reduceCesiumFidelity(state, {
        type: "frameObserved",
        operationId: 1,
        blank,
      });
    expect(state.phase).toBe("ready");
    state = reduceCesiumFidelity(state, {
      type: "frameObserved",
      operationId: 1,
      blank: true,
    });
    expect(state).toMatchObject({ phase: "partial", reason: "blankFrames" });
  });
  it("ignores diagnostics before ready and all stale outcomes", () => {
    const state = start(2);
    expect(
      reduceCesiumFidelity(state, {
        type: "frameObserved",
        operationId: 2,
        blank: true,
      }),
    ).toBe(state);
    expect(
      reduceCesiumFidelity(state, {
        type: "tileFailed",
        operationId: 1,
        atMs: 0,
      }),
    ).toBe(state);
    expect(
      reduceCesiumFidelity(state, {
        type: "initialTilesSettled",
        operationId: 1,
        result: "timeout",
      }),
    ).toBe(state);
    expect(
      reduceCesiumFidelity(state, { type: "sessionStarted", operationId: 1 }),
    ).toBe(state);
  });
  it("clears health on disposal and rejects late outcomes before a fresh session", () => {
    const state = reduceCesiumFidelity(fail(ready(), 8), { type: "disposed" });
    expect(state).toMatchObject({
      phase: "disposed",
      tileFailureTimes: [],
      blankFrameCount: 0,
    });
    expect(
      reduceCesiumFidelity(state, {
        type: "initialTilesSettled",
        operationId: 1,
        result: "loaded",
      }),
    ).toBe(state);
    expect(
      reduceCesiumFidelity(state, { type: "sessionStarted", operationId: 3 }),
    ).toMatchObject({ phase: "loading", operationId: 3, tileFailureTimes: [] });
  });
  it("preserves sticky health if reused without disposal", () => {
    const state = fail(start(), 8);
    expect(
      reduceCesiumFidelity(state, { type: "sessionStarted", operationId: 2 }),
    ).toMatchObject({
      phase: "partial",
      reason: "tileFailures",
      operationId: 2,
    });
  });
});

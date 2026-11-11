import { describe, expect, it } from "vitest";
import { initialPlanningMapState, reducePlanningMap, type PlanningMapState } from "./planning-map-state";

describe("planning map lifecycle", () => {
  it("starts loading without previous errors", () => {
    expect(initialPlanningMapState(1)).toEqual({ status: "loading", operationId: 1, errorCount: 0 });
  });

  it("waits through three errors and marks the fourth unavailable", () => {
    let state = initialPlanningMapState(1);
    for (let count = 1; count <= 3; count++) {
      state = reducePlanningMap(state, { type: "mapError", operationId: 1, loaded: false });
      expect(state).toMatchObject({ status: "loading", errorCount: count });
    }
    expect(reducePlanningMap(state, { type: "mapError", operationId: 1, loaded: false }))
      .toMatchObject({ status: "unavailable", errorCount: 4, reason: "errors" });
  });

  it("accumulates errors while loaded without hiding the map", () => {
    let state = initialPlanningMapState(1);
    for (let count = 0; count < 8; count++) {
      state = reducePlanningMap(state, { type: "mapError", operationId: 1, loaded: true });
    }
    expect(state.status).toBe("loading");
    expect(reducePlanningMap(state, { type: "mapError", operationId: 1, loaded: false }).status)
      .toBe("unavailable");
  });

  it("does not clear prior errors on readiness", () => {
    let state = initialPlanningMapState(1);
    for (let count = 0; count < 3; count++) {
      state = reducePlanningMap(state, { type: "mapError", operationId: 1, loaded: false });
    }
    state = reducePlanningMap(state, { type: "mapIdle", operationId: 1 });
    expect(state).toMatchObject({ status: "ready", errorCount: 3 });
    expect(reducePlanningMap(state, { type: "mapError", operationId: 1, loaded: false }).status)
      .toBe("unavailable");
  });

  it("leaves a loaded map unchanged when the deadline arrives before idle", () => {
    const state = initialPlanningMapState(1);
    expect(reducePlanningMap(state, { type: "deadlineReached", operationId: 1, loaded: true })).toBe(state);
  });

  it("recovers from the deadline when initial idle arrives late", () => {
    const loading = initialPlanningMapState(1);
    const failed = reducePlanningMap(loading, { type: "deadlineReached", operationId: 1, loaded: false });
    expect(failed).toMatchObject({ status: "unavailable", reason: "deadline" });
    expect(reducePlanningMap(failed, { type: "mapIdle", operationId: 1 })).toEqual({
      status: "ready", operationId: 1, errorCount: 0,
    });
  });

  it("recovers from source errors without resetting their cumulative budget", () => {
    const failed: PlanningMapState = { status: "unavailable", operationId: 1, errorCount: 4, reason: "errors" };
    const ready = reducePlanningMap(failed, { type: "mapIdle", operationId: 1 });
    expect(ready).toEqual({ status: "ready", operationId: 1, errorCount: 4 });
    expect(reducePlanningMap(ready, { type: "mapError", operationId: 1, loaded: true }).status).toBe("ready");
  });

  it("resets the budget for a new effect lifetime and rejects superseded outcomes", () => {
    const failed: PlanningMapState = { status: "unavailable", operationId: 1, errorCount: 4, reason: "errors" };
    const replacement = reducePlanningMap(failed, { type: "mapStarted", operationId: 2 });
    expect(replacement).toEqual({ status: "loading", operationId: 2, errorCount: 0 });
    expect(reducePlanningMap(replacement, { type: "mapIdle", operationId: 1 })).toBe(replacement);
    expect(reducePlanningMap(replacement, { type: "mapError", operationId: 1, loaded: false })).toBe(replacement);
    expect(reducePlanningMap(replacement, { type: "deadlineReached", operationId: 1, loaded: false })).toBe(replacement);
    expect(reducePlanningMap(replacement, { type: "mapStarted", operationId: 1 })).toBe(replacement);
    expect(reducePlanningMap(replacement, { type: "mapStarted", operationId: 2 })).toBe(replacement);
  });
});

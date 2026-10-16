import { describe, expect, it } from "vitest";

import {
  initialRegionalTransitionState,
  reduceRegionalTransition,
  regionalOperationIsCurrent,
  type RegionalTransitionEvent,
  type RegionalTransitionState,
} from "@/surfaces/atlas/regional-transition-state";

function selected() {
  return reduceRegionalTransition(initialRegionalTransitionState(), {
    type: "regionSelected", regionName: "Kyoto, Japan",
  });
}

const outcomes: RegionalTransitionEvent[] = [
  { type: "transitionSettled", operationId: 1, terrainReady: true },
  { type: "transitionSettled", operationId: 1, terrainReady: false },
  { type: "terrainFailed", operationId: 1 },
  { type: "tileFailed", operationId: 1, atMs: 100 },
  { type: "frameObserved", operationId: 1, blank: true },
];

describe("regional transition state", () => {
  it("starts globally and allocates a fresh operation for each selection", () => {
    const initial = initialRegionalTransitionState();
    expect(initial).toEqual({ status: "global", operationId: 0 });
    const first = selected();
    expect(first).toEqual({ status: "loading", operationId: 1, regionName: "Kyoto, Japan", tileFailureTimes: [], blankFrameCount: 0 });
    const second = reduceRegionalTransition(first, { type: "regionSelected", regionName: "Kyoto, Japan" });
    expect(second.operationId).toBe(2);
    expect(regionalOperationIsCurrent(second, 1)).toBe(false);
    expect(regionalOperationIsCurrent(second, 2)).toBe(true);
  });

  it.each([true, false])("settles joined work with terrainReady %s", (terrainReady) => {
    const state = reduceRegionalTransition(selected(), { type: "transitionSettled", operationId: 1, terrainReady });
    expect(state.status).toBe(terrainReady ? "ready" : "fallback");
    expect(regionalOperationIsCurrent(state, 1)).toBe(terrainReady);
    expect(reduceRegionalTransition(state, { type: "transitionSettled", operationId: 1, terrainReady: !terrainReady })).toBe(state);
  });

  it.each(["loading", "ready"] as const)("falls back on terrain failure from %s", (status) => {
    let state = selected();
    if (status === "ready") state = reduceRegionalTransition(state, outcomes[0]);
    const failed = reduceRegionalTransition(state, { type: "terrainFailed", operationId: 1 });
    expect(failed).toEqual({ status: "fallback", operationId: 1, regionName: "Kyoto, Japan" });
    expect(reduceRegionalTransition(failed, outcomes[0])).toBe(failed);
    expect(reduceRegionalTransition(failed, { type: "regionSelected", regionName: "Crete, Greece" })).toEqual({
      status: "loading", operationId: 2, regionName: "Crete, Greece", tileFailureTimes: [], blankFrameCount: 0,
    });
  });

  it("counts only tile failures in the inclusive fifteen-second window", () => {
    let state = selected();
    for (let i = 0; i < 7; i++) state = reduceRegionalTransition(state, { type: "tileFailed", operationId: 1, atMs: 0 });
    const expired = reduceRegionalTransition(state, { type: "tileFailed", operationId: 1, atMs: 15_001 });
    expect(expired).toMatchObject({ status: "loading", tileFailureTimes: [15_001] });
    expect(reduceRegionalTransition(state, { type: "tileFailed", operationId: 1, atMs: 15_000 }).status).toBe("fallback");
  });

  it("samples blank frames only after ready and resets on a visible frame", () => {
    const loading = selected();
    const blank: RegionalTransitionEvent = { type: "frameObserved", operationId: 1, blank: true };
    expect(reduceRegionalTransition(loading, blank)).toBe(loading);
    let state = reduceRegionalTransition(loading, outcomes[0]);
    state = reduceRegionalTransition(state, blank);
    expect(state.status).toBe("ready");
    state = reduceRegionalTransition(state, { ...blank, blank: false });
    state = reduceRegionalTransition(state, blank);
    expect(state.status).toBe("ready");
    state = reduceRegionalTransition(state, blank);
    expect(state.status).toBe("fallback");
  });

  it.each(["global", "disposed", "fallback", "replacement"])("rejects every obsolete outcome after %s", (status) => {
    let state: RegionalTransitionState = selected();
    if (status === "global") state = reduceRegionalTransition(state, { type: "selectionCleared" });
    if (status === "disposed") state = reduceRegionalTransition(state, { type: "disposed" });
    if (status === "fallback") state = reduceRegionalTransition(state, { type: "terrainFailed", operationId: 1 });
    if (status === "replacement") state = reduceRegionalTransition(state, { type: "regionSelected", regionName: "Crete, Greece" });
    for (const event of outcomes) expect(reduceRegionalTransition(state, event)).toBe(state);
  });
});

import { describe, expect, it } from "vitest";
import { initialRouteLeafMapState, reduceRouteLeafMap, type RouteLeafMapEvent, type RouteLeafMapState } from "./route-leaf-map-state";

const started = () => reduceRouteLeafMap(initialRouteLeafMapState(2), { type: "sessionStarted", sessionId: 1 });
const event = (type: RouteLeafMapEvent["type"], sessionId = 1): RouteLeafMapEvent => ({ type, sessionId });
const apply = (state: RouteLeafMapState, ...types: RouteLeafMapEvent["type"][]) => types.reduce((current, type) => reduceRouteLeafMap(current, event(type)), state);

describe("Route Leaf map lifecycle", () => {
  it.each([0, 1])("shows missing geometry for %i points without accepting provider outcomes", (count) => {
    const state = initialRouteLeafMapState(count);
    expect(state.status).toBe("unavailable");
    for (const type of ["mapIdle", "sourceError", "deadlineReached"] as const) expect(reduceRouteLeafMap(state, event(type))).toBe(state);
  });

  it("waits for first idle and ignores later deadlines and errors", () => {
    const waiting = started();
    expect(waiting.status).toBe("loading");
    const ready = apply(waiting, "mapIdle");
    expect(ready).toEqual({ phase: "ready", status: "ready", sessionId: 1 });
    for (const type of ["mapIdle", "sourceError", "deadlineReached"] as const) expect(reduceRouteLeafMap(ready, event(type))).toBe(ready);
  });

  it("fails only at four errors and recovers on late idle", () => {
    const three = apply(started(), "sourceError", "sourceError", "sourceError");
    expect(three.status).toBe("loading");
    const four = apply(three, "sourceError");
    expect(four.status).toBe("unavailable");
    expect(apply(four, "mapIdle").status).toBe("ready");
  });

  it("recovers after deadline regardless of error ordering", () => {
    for (const sequence of [
      ["deadlineReached", "sourceError", "sourceError", "sourceError", "sourceError"],
      ["sourceError", "sourceError", "sourceError", "sourceError", "deadlineReached"],
    ] as const) {
      const unavailable = apply(started(), ...sequence);
      expect(unavailable.status).toBe("unavailable");
      expect(apply(unavailable, "mapIdle").status).toBe("ready");
      expect(reduceRouteLeafMap(unavailable, event("deadlineReached"))).toBe(unavailable);
    }
  });

  it.each(["mapIdle", "sourceError", "deadlineReached"] as const)("rejects stale %s after replacement", (type) => {
    const replacement = reduceRouteLeafMap(started(), event("sessionStarted", 2));
    expect(reduceRouteLeafMap(replacement, event(type))).toBe(replacement);
    expect(reduceRouteLeafMap(replacement, event(type, 3))).toBe(replacement);
  });

  it.each(["ready", "unavailable"] as const)("retains %s presentation during effect replacement but resets readiness and error count", (status) => {
    const previous = apply(started(), status === "ready" ? "mapIdle" : "deadlineReached");
    const replacement = reduceRouteLeafMap(previous, event("sessionStarted", 2));
    expect(replacement).toEqual({ phase: "waiting", status, errorCount: 0, sessionId: 2 });
    expect(reduceRouteLeafMap(replacement, event("deadlineReached", 2)).status).toBe("unavailable");
    expect(reduceRouteLeafMap(replacement, event("mapIdle", 2)).status).toBe("ready");
  });

  it("ignores duplicate and old starts", () => {
    const state = started();
    expect(reduceRouteLeafMap(state, event("sessionStarted"))).toBe(state);
    expect(reduceRouteLeafMap(state, event("sessionStarted", 0))).toBe(state);
  });
});

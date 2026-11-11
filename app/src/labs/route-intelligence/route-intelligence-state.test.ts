import { describe, expect, it } from "vitest";
import { buildRouteGenome } from "./route-genome";
import { initialRouteIntelligenceState, reduceRouteIntelligence, selectedRouteIntelligenceEntry, type LabRoute } from "./route-intelligence-state";
import { parseRouteDetail } from "@/domain/route";
import fixture from "../../../public/data/routes/14736711660.json";

const route = parseRouteDetail(fixture);
const entry: LabRoute = { route, genome: buildRouteGenome(route) };
const settle = (routes: LabRoute[], hasRequestFailure = false) => ({
  type: "routesSettled" as const, routes, expectedCount: 2, hasRequestFailure,
});

describe("route intelligence loading", () => {
  it("starts loading without settled data", () => {
    expect(initialRouteIntelligenceState()).toEqual({ status: "loading" });
  });
  it("publishes all routes in their input order", () => {
    const other = { ...entry, route: { ...route, activityId: "other" } };
    expect(reduceRouteIntelligence(initialRouteIntelligenceState(), settle([entry, other])))
      .toEqual({ status: "complete", routes: [entry, other] });
  });
  it("preserves a surviving route when another is absent or failed", () => {
    for (const failed of [false, true]) {
      expect(reduceRouteIntelligence(initialRouteIntelligenceState(), settle([entry], failed)))
        .toEqual({ status: "partial", routes: [entry] });
    }
  });
  it("distinguishes no records from failed requests without inventing route data", () => {
    expect(reduceRouteIntelligence(initialRouteIntelligenceState(), settle([]))).toEqual({ status: "empty" });
    expect(reduceRouteIntelligence(initialRouteIntelligenceState(), settle([], true))).toEqual({ status: "failed" });
  });
  it("ignores completions after the load has settled", () => {
    for (const event of [settle([entry, entry]), settle([entry]), settle([]), settle([], true)]) {
      const state = reduceRouteIntelligence(initialRouteIntelligenceState(), event);
      expect(reduceRouteIntelligence(state, settle([]))).toBe(state);
    }
  });
});


describe("route intelligence selection", () => {
  it("uses the preferred route when available and the surviving route otherwise", () => {
    const other = { ...entry, route: { ...route, activityId: "other" } };
    const complete = reduceRouteIntelligence(initialRouteIntelligenceState(), settle([entry, other]));
    expect(selectedRouteIntelligenceEntry(complete, "other")).toBe(other);
    const partial = reduceRouteIntelligence(initialRouteIntelligenceState(), settle([other]));
    expect(selectedRouteIntelligenceEntry(partial, route.activityId)).toBe(other);
  });
  it("does not invent selection while loading or after no routes load", () => {
    expect(selectedRouteIntelligenceEntry(initialRouteIntelligenceState(), route.activityId)).toBeUndefined();
    expect(selectedRouteIntelligenceEntry({ status: "failed" }, route.activityId)).toBeUndefined();
  });
});

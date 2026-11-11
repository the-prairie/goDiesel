import { describe, expect, it } from "vitest";

import {
  initialRouteDetailLoadState,
  reduceRouteDetailLoad,
  routeDetailView,
  type RouteDetailLoadState,
} from "@/data/route-detail-state";
import type { RouteDetailResult } from "@/data/route-repository";

const ready = {
  status: "ready",
  route: { slug: "kyoto" },
} as RouteDetailResult;
const missing = { status: "not-found" } as const satisfies RouteDetailResult;

function load(slug: string, requestKey = 0) {
  return reduceRouteDetailLoad(initialRouteDetailLoadState(), {
    type: "loadStarted",
    slug,
    requestKey,
  });
}

function settle(slug: string, result: RouteDetailResult, requestKey = 0) {
  return reduceRouteDetailLoad(load(slug, requestKey), {
    type: "resultReceived",
    slug,
    requestKey,
    result,
  });
}

describe("route detail load", () => {
  it("stays idle until a route is selected", () => {
    const idle = initialRouteDetailLoadState();
    expect(routeDetailView(idle)).toEqual({ status: "idle" });
    expect(reduceRouteDetailLoad(idle, { type: "selectionCleared" })).toBe(idle);
    expect(
      reduceRouteDetailLoad(idle, {
        type: "resultReceived",
        slug: "kyoto",
        requestKey: 0,
        result: ready,
      }),
    ).toBe(idle);
  });

  it("shows loading for a different route and keeps that phase free of a payload", () => {
    const kyoto = settle("kyoto", ready);
    const osaka = reduceRouteDetailLoad(kyoto, {
      type: "loadStarted",
      slug: "osaka",
      requestKey: 0,
    });
    expect(osaka.phase).toEqual({ status: "loading", slug: "osaka", requestKey: 0 });
    expect(routeDetailView(osaka)).toEqual({ status: "loading" });
    expect("result" in osaka.phase).toBe(false);
  });

  it("shows the same route again after the selection clears", () => {
    const settled = settle("kyoto", ready);
    const cleared = reduceRouteDetailLoad(settled, { type: "selectionCleared" });
    expect(routeDetailView(cleared)).toEqual({ status: "idle" });
    const again = reduceRouteDetailLoad(cleared, {
      type: "loadStarted",
      slug: "kyoto",
      requestKey: 0,
    });
    expect(routeDetailView(again)).toEqual(ready);
    const otherKey = reduceRouteDetailLoad(cleared, {
      type: "loadStarted",
      slug: "kyoto",
      requestKey: 1,
    });
    expect(routeDetailView(otherKey)).toEqual({ status: "loading" });
    expect("result" in otherKey.phase).toBe(false);
  });

  it("ignores a result from a replaced request", () => {
    const retry = reduceRouteDetailLoad(load("kyoto", 1), {
      type: "loadStarted",
      slug: "kyoto",
      requestKey: 2,
    });
    expect(
      reduceRouteDetailLoad(retry, {
        type: "resultReceived",
        slug: "kyoto",
        requestKey: 1,
        result: missing,
      }),
    ).toBe(retry);
    const settled = reduceRouteDetailLoad(retry, {
      type: "resultReceived",
      slug: "kyoto",
      requestKey: 2,
      result: ready,
    });
    expect(routeDetailView(settled)).toBe(ready);
  });

  it("accepts each settled outcome for the matching request", () => {
    const outcomes: RouteDetailResult[] = [
      ready,
      missing,
      { status: "invalid", message: "Route data is invalid." },
      { status: "error", message: "Route data could not be loaded." },
    ];
    for (const result of outcomes) {
      const state: RouteDetailLoadState = settle("kyoto", result);
      expect(routeDetailView(state)).toEqual(result);
    }
  });
});

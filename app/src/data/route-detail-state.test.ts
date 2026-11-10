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

  it("shows loading for the selected route and no earlier route", () => {
    const kyoto = reduceRouteDetailLoad(load("kyoto"), {
      type: "resultReceived",
      slug: "kyoto",
      requestKey: 0,
      result: ready,
    });
    const osaka = reduceRouteDetailLoad(kyoto, {
      type: "loadStarted",
      slug: "osaka",
      requestKey: 0,
    });
    expect(osaka).toEqual({ status: "loading", slug: "osaka", requestKey: 0 });
    expect(routeDetailView(osaka)).toEqual({ status: "loading" });
    expect("result" in osaka).toBe(false);
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

  it("drops a settled route when the selection clears", () => {
    const settled = reduceRouteDetailLoad(load("kyoto"), {
      type: "resultReceived",
      slug: "kyoto",
      requestKey: 0,
      result: ready,
    });
    const cleared = reduceRouteDetailLoad(settled, { type: "selectionCleared" });
    expect(routeDetailView(cleared)).toEqual({ status: "idle" });
    expect(reduceRouteDetailLoad(load("kyoto"), { type: "loadStarted", slug: "kyoto", requestKey: 0 })).toEqual(
      load("kyoto"),
    );
  });

  it("accepts each settled outcome for the matching request", () => {
    const outcomes: RouteDetailResult[] = [
      ready,
      missing,
      { status: "invalid", message: "Route data is invalid." },
      { status: "error", message: "Route data could not be loaded." },
    ];
    for (const result of outcomes) {
      const state: RouteDetailLoadState = reduceRouteDetailLoad(load("kyoto"), {
        type: "resultReceived",
        slug: "kyoto",
        requestKey: 0,
        result,
      });
      expect(routeDetailView(state)).toEqual(result);
    }
  });
});

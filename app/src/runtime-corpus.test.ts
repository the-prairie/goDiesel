import { describe, expect, it } from "vitest";

import type { RouteSummary } from "@/domain/route";
import {
  countUniqueRouteTraces,
  createDistinctRouteCorpus,
} from "../perf/runtime-corpus";

const route = {
  slug: "source",
  activityId: "source-activity",
  replay: {},
  guide: {},
  trace: [
    { lat: 51, lng: -114 },
    { lat: 51.01, lng: -113.99 },
    { lat: 51.02, lng: -113.98 },
  ],
} as RouteSummary;

describe("createDistinctRouteCorpus", () => {
  it("counts unique coordinate values instead of array identity", () => {
    expect(
      countUniqueRouteTraces([
        route,
        { ...route, trace: route.trace.map((point) => ({ ...point })) },
      ]),
    ).toBe(1);
  });

  it("retains every distinct geometry at the requested scale", () => {
    const corpus = createDistinctRouteCorpus([route], 2_500);

    expect(corpus.routes).toHaveLength(2_500);
    expect(corpus.uniqueTraceCount).toBe(2_500);
  });

  it("preserves source point order and route shape under rigid translation", () => {
    const corpus = createDistinctRouteCorpus([route], 50);

    corpus.routes.forEach((replica) => {
      expect(replica.trace).toHaveLength(route.trace.length);
      for (let index = 1; index < replica.trace.length; index += 1) {
        expect(replica.trace[index].lat - replica.trace[index - 1].lat).toBeCloseTo(
          route.trace[index].lat - route.trace[index - 1].lat,
          10,
        );
        expect(replica.trace[index].lng - replica.trace[index - 1].lng).toBeCloseTo(
          route.trace[index].lng - route.trace[index - 1].lng,
          10,
        );
      }
    });
  });
});

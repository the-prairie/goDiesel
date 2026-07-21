import { describe, expect, it } from "vitest";

import { visibleAtlasLabels } from "@/components/globe/atlas-label-layout";
import {
  sampleGlobalRoutePoints,
  sampleRegionalRoutePoints,
} from "@/components/globe/atlas-world";
import { completedRoutes } from "@/data/routes";

describe("global Atlas geometry", () => {
  it("bounds route sampling while preserving both endpoints", () => {
    const route = completedRoutes.find((candidate) => candidate.trace.length > 10)!;
    const sampled = sampleGlobalRoutePoints(route, 8);

    expect(sampled.length).toBeLessThanOrEqual(8);
    expect(sampled[0]).toBe(route.trace[0]);
    expect(sampled.at(-1)).toBe(route.trace.at(-1));
  });

  it("keeps a denser regional trace within its point budget", () => {
    const route = completedRoutes.find((candidate) => candidate.trace.length > 10)!;
    const sampled = sampleRegionalRoutePoints(route, 10);

    expect(sampled.length).toBeLessThanOrEqual(10);
    expect(sampled[0]).toBe(route.trace[0]);
    expect(sampled.at(-1)).toBe(route.trace.at(-1));
  });

  it("excludes non-ready and malformed geometry from regional terrain", () => {
    const route = completedRoutes.find((candidate) => candidate.trace.length > 2)!;
    const malformedPoint = { ...route.trace[1], lat: 95 };
    const readyRoute = {
      ...route,
      trace: [route.trace[0], malformedPoint, route.trace[2]],
    };
    const unavailableRoute = {
      ...readyRoute,
      replay: { ...route.replay, geometryStatus: "invalid" as const },
    };

    expect(sampleRegionalRoutePoints(readyRoute)).toEqual([
      route.trace[0],
      route.trace[2],
    ]);
    expect(sampleRegionalRoutePoints(unavailableRoute)).toEqual([]);
  });

  it("keeps the selected label and suppresses collisions", () => {
    const visible = visibleAtlasLabels(
      [
        { name: "A", x: 600, y: 400, width: 140, height: 28, priority: 1, selected: false, visible: true },
        { name: "B", x: 610, y: 405, width: 140, height: 28, priority: 100, selected: true, visible: true },
      ],
      { width: 1_200, height: 800 },
    );

    expect(visible).toEqual(["B"]);
  });
});

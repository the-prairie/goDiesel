import { describe, expect, it } from "vitest";

import { visibleAtlasLabels } from "@/components/globe/atlas-label-layout";
import { sampleGlobalRoutePoints } from "@/components/globe/atlas-world";
import { completedRoutes } from "@/data/routes";

describe("global Atlas geometry", () => {
  it("bounds route sampling while preserving both endpoints", () => {
    const route = completedRoutes.find((candidate) => candidate.trace.length > 10)!;
    const sampled = sampleGlobalRoutePoints(route, 8);

    expect(sampled.length).toBeLessThanOrEqual(8);
    expect(sampled[0]).toBe(route.trace[0]);
    expect(sampled.at(-1)).toBe(route.trace.at(-1));
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

import { describe, expect, it } from "vitest";

import { routeRepairEvidence, routeRepairs } from "@/domain/geometry/route-repairs";
import type { QuestRoute } from "@/domain/routes";

function route(discontinuities: QuestRoute["provenance"]["discontinuities"]) {
  return {
    route: [
      { lat: 50, lng: -115, elev: 1_000, d: 0 },
      { lat: 51, lng: -114, elev: 1_100, d: 1_000 },
    ],
    provenance: {
      temporal: { status: "unavailable" as const },
      track: { segmentCount: 1 },
      discontinuities,
    },
  };
}

describe("routeRepairs", () => {
  it("places source-backed evidence on the route distance axis", () => {
    const repairs = routeRepairs(
      route([
        {
          kind: "recording_gap",
          source: "recorded_timestamps",
          startD: 390,
          endD: 410,
          elapsedTimeS: 366,
        },
      ]),
    );

    expect(repairs).toHaveLength(1);
    expect(repairs[0]).toMatchObject({
      distanceM: 400,
      distanceRatio: 0.4,
      point: { lat: 50.4, lng: -114.6 },
    });
    expect(routeRepairEvidence(repairs[0])).toBe("6 min 6 sec between recorded points.");
  });

  it("does not invent repairs for a clean route", () => {
    expect(routeRepairs(route([]))).toEqual([]);
  });
});

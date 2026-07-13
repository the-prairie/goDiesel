import { describe, expect, it } from "vitest";

import { parseRouteDetail, parseRouteSummary } from "@/domain/routes";

describe("parseRouteDetail", () => {
  it("derives missing geometry from the validated route points", () => {
    const route = parseRouteDetail({
      slug: "route-without-geometry",
      activity_id: "activity-1",
      lifecycle: "completed",
      name: "Missing route",
      route: [],
      replay: {
        replay_eligible: true,
        geometry_status: "ready",
      },
    });

    expect(route.route).toEqual([]);
    expect(route.replay.geometryStatus).toBe("missing");
    expect(route.replay.replayEligible).toBe(false);
  });

  it("rejects records without a stable slug", () => {
    expect(() => parseRouteDetail({ route: [] })).toThrow(
      "Route detail is missing slug",
    );
  });
});

describe("parseRouteSummary", () => {
  it("expands compact generated trace tuples", () => {
    const route = parseRouteSummary({
      slug: "compact-route",
      activity_id: "activity-2",
      lifecycle: "completed",
      name: "Compact route",
      trace: [[51.1, -114.1, 1234, 500]],
      replay: { geometry_status: "ready" },
    });

    expect(route.trace).toEqual([
      { lat: 51.1, lng: -114.1, elev: 1234, d: 500 },
    ]);
  });
});

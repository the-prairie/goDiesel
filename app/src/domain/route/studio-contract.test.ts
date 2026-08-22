import { describe, expect, it } from "vitest";

import { parseRouteDetail, parseRouteSummary } from "@/domain/route";

function detail(overrides: Record<string, unknown> = {}) {
  return {
    slug: "route-a1b2c3d4e5f6",
    route_id: "route-a1b2c3d4e5f6",
    identity_kind: "imported-route",
    source_kind: "owner-import",
    source_format: "kml",
    lifecycle: "discovered",
    name: "Calgary, AB",
    subtitle: "Synthetic ridge",
    activity_name: "Synthetic ridge",
    region: "Calgary, AB",
    date: "",
    distance_km: 1.2,
    elevation_gain_m: 0,
    type: "Run",
    description: "",
    completion_rule: "Complete the route.",
    difficulty: "Easy",
    theme: "Wander Run",
    xp: 60,
    center_lat: 51.005,
    center_lng: -114.005,
    mid_idx: 1,
    route: [
      { lat: 51, lng: -114, elev: 0, d: 0 },
      { lat: 51.01, lng: -114.01, elev: 0, d: 1200 },
    ],
    replay: {
      mode: "atlas",
      replay_eligible: true,
      best_in_earth: false,
      geometry_status: "ready",
    },
    curation: { review_status: "draft" },
    annotations: [],
    provenance: {
      temporal: { status: "unavailable" },
      elevation: { status: "unavailable" },
      track: { segment_count: 1 },
      discontinuities: [],
    },
    ...overrides,
  };
}

describe("Route Studio identity compatibility", () => {
  it("parses imported route identity without pretending it is a Strava activity", () => {
    const route = parseRouteDetail(detail());

    expect(route.routeId).toBe("route-a1b2c3d4e5f6");
    expect(route.identityKind).toBe("imported-route");
    expect(route.stravaActivityId).toBeUndefined();
    expect(route.activityId).toBe(route.routeId);
    expect(route.source).toEqual({ kind: "owner-import", format: "kml" });
    expect(route.provenance.elevation?.status).toBe("unavailable");
  });

  it("keeps legacy Strava summaries stable", () => {
    const summary = parseRouteSummary({
      ...detail({
        slug: "12345",
        route_id: undefined,
        activity_id: "12345",
        identity_kind: undefined,
        source_kind: "strava-export",
        source_format: undefined,
      }),
      trace: [
        [51, -114, 1000, 0],
        [51.01, -114.01, 1010, 1200],
      ],
      guide_preview: { review_status: "draft" },
    });

    expect(summary.routeId).toBe("12345");
    expect(summary.activityId).toBe("12345");
    expect(summary.stravaActivityId).toBe("12345");
    expect(summary.identityKind).toBe("strava-activity");
    expect(summary.source).toEqual({ kind: "strava-export", format: "gpx" });
  });

  it("rejects an imported identity that also claims an activity id", () => {
    expect(() => parseRouteDetail(detail({ activity_id: "999" }))).toThrow(
      "imported route must not claim a Strava activity_id",
    );
  });
});

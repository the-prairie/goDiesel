import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";

import manifest from "@/data/generated/routes.manifest.json";
import { parseRouteDetail, parseRouteSummary } from "@/domain/route";

function validRouteDetail(overrides: Record<string, unknown> = {}) {
  return {
    slug: "valid-route",
    activity_id: "activity-1",
    lifecycle: "completed",
    name: "Valid route",
    subtitle: "A good day out",
    activity_name: "Morning Run",
    region: "Calgary, Canada",
    date: "2026-07-12",
    distance_km: 12.4,
    elevation_gain_m: 240,
    type: "Run",
    description: "A representative route.",
    completion_rule: "Complete the route.",
    difficulty: "Moderate",
    theme: "Explore",
    xp: 120,
    center_lat: 51.05,
    center_lng: -114.07,
    mid_idx: 1,
    route: [
      { lat: 51.05, lng: -114.07, elev: 1050, d: 0 },
      { lat: 51.06, lng: -114.08, elev: 1060, d: 1000 },
    ],
    replay: {
      mode: "atlas",
      replay_eligible: true,
      best_in_earth: false,
      geometry_status: "ready",
    },
    curation: {
      vibe: "Quiet lanes opening into a sustained climb.",
      ideal_use: "A long, unhurried exploration day.",
      terrain: ["Paved lanes", "Steep hillside roads"],
      difficulty: "Demanding",
      highlights: ["Temple district", "Eastern hills"],
      caveats: ["Expect frequent road crossings"],
      seasonality: "Best in cool, dry weather.",
      editorial_note: "Preserved for its contrast and scale.",
      review_status: "reviewed",
    },
    ...overrides,
  };
}

describe("parseRouteDetail", () => {
  it("validates every generated full route record", () => {
    const detailDirectory = new URL("../../public/data/routes/", import.meta.url);
    const files = readdirSync(detailDirectory).filter((file) => file.endsWith(".json"));

    expect(files).toHaveLength(manifest.routes.length);
    for (const file of files) {
      const route = parseRouteDetail(
        JSON.parse(readFileSync(new URL(file, detailDirectory), "utf8")),
      );
      expect(route.slug).toBe(file.replace(/\.json$/, ""));
    }
  });

  it("loads the representative reviewed guide from generated curation", () => {
    const detail = JSON.parse(
      readFileSync(
        new URL("../../public/data/routes/17654151284.json", import.meta.url),
        "utf8",
      ),
    );

    expect(parseRouteDetail(detail).curation).toMatchObject({
      vibe: expect.stringContaining("exploratory Kyoto run"),
      idealUse: expect.stringContaining("long-run day"),
      caveats: expect.arrayContaining([
        expect.stringContaining("navigation conditions are not validated"),
      ]),
      reviewStatus: "reviewed",
    });
  });

  it("parses recorded route provenance and per-point elapsed time", () => {
    const route = parseRouteDetail(validRouteDetail({
      route: [
        { lat: 51.05, lng: -114.07, elev: 1050, d: 0, elapsed_s: 5 },
        { lat: 51.06, lng: -114.08, elev: 1060, d: 1000, elapsed_s: 185 },
      ],
      provenance: {
        temporal: {
          status: "recorded",
          start_time_utc: "2026-07-12T12:00:00Z",
          elapsed_time_s: 185,
          time_zone: "America/Edmonton",
        },
        track: { segment_count: 2 },
        discontinuities: [
          {
            kind: "segment_boundary",
            source: "recorded_track_segment",
            start_d: 400,
            end_d: 500,
            elapsed_time_s: 20,
          },
        ],
      },
    }));

    expect(route.route.map((point) => point.elapsedS)).toEqual([5, 185]);
    expect(route.provenance).toEqual({
      temporal: {
        status: "recorded",
        startTimeUtc: "2026-07-12T12:00:00Z",
        elapsedTimeS: 185,
        timeZone: "America/Edmonton",
      },
      track: { segmentCount: 2 },
      discontinuities: [
        {
          kind: "segment_boundary",
          source: "recorded_track_segment",
          startD: 400,
          endD: 500,
          elapsedTimeS: 20,
        },
      ],
    });
  });

  it("keeps legacy route records valid with unavailable provenance", () => {
    expect(parseRouteDetail(validRouteDetail()).provenance).toEqual({
      temporal: { status: "unavailable" },
      track: { segmentCount: 1 },
      discontinuities: [],
    });
  });

  it("allows discovered geometry to be previewed without marking it completed", () => {
    const parsed = parseRouteDetail(validRouteDetail({
      lifecycle: "discovered",
      replay: {
        mode: "atlas",
        replay_eligible: true,
        best_in_earth: false,
        geometry_status: "ready",
        point_count: 2,
      },
    }));

    expect(parsed.lifecycle).toBe("discovered");
    expect(parsed.replay.replayEligible).toBe(true);
  });

  it("rejects discontinuities outside recorded route distance", () => {
    expect(() => parseRouteDetail(validRouteDetail({
      provenance: {
        temporal: { status: "unavailable" },
        track: { segment_count: 1 },
        discontinuities: [
          {
            kind: "recording_gap",
            source: "recorded_timestamps",
            start_d: 900,
            end_d: 1200,
            elapsed_time_s: 180,
          },
        ],
      },
    }))).toThrow("provenance discontinuity exceeds route distance");
  });

  it("preserves provenance when geometry is intentionally unavailable", () => {
    const route = parseRouteDetail(validRouteDetail({
      route: [],
      provenance: {
        temporal: { status: "unavailable" },
        track: { segment_count: 1 },
        discontinuities: [
          {
            kind: "recording_gap",
            source: "recorded_timestamps",
            start_d: 900,
            end_d: 1200,
            elapsed_time_s: 180,
          },
        ],
      },
    }));

    expect(route.replay.geometryStatus).toBe("missing");
    expect(route.provenance.discontinuities).toHaveLength(1);
  });

  it("derives missing geometry from the validated route points", () => {
    const route = parseRouteDetail(validRouteDetail({
      slug: "route-without-geometry",
      name: "Missing route",
      route: [],
    }));

    expect(route.route).toEqual([]);
    expect(route.replay.geometryStatus).toBe("missing");
    expect(route.replay.replayEligible).toBe(false);
  });

  it("rejects records without a stable slug", () => {
    expect(() => parseRouteDetail({ ...validRouteDetail(), slug: "", activity_id: "" })).toThrow(
      "Route detail is missing slug",
    );
  });

  it("disables replay when any geometry point is malformed or out of range", () => {
    const malformed = parseRouteDetail(validRouteDetail({
      route: [
        { lat: 51.05, lng: -114.07, elev: 1050, d: 0 },
        { lat: "bad", lng: -114.08, elev: 1060, d: 500 },
        { lat: 51.06, lng: -114.08, elev: 1060, d: 1000 },
      ],
    }));
    const outOfRange = parseRouteDetail(validRouteDetail({
      route: [
        { lat: 999, lng: -114.07, elev: 1050, d: 0 },
        { lat: 51.06, lng: -114.08, elev: 1060, d: 1000 },
      ],
    }));

    expect(malformed.route).toEqual([]);
    expect(malformed.replay.geometryStatus).toBe("invalid");
    expect(malformed.replay.replayEligible).toBe(false);
    expect(outOfRange.replay.geometryStatus).toBe("invalid");
    expect(outOfRange.replay.replayEligible).toBe(false);
  });

  it("rejects malformed core route and replay metadata", () => {
    expect(() => parseRouteDetail(validRouteDetail({ distance_km: "12.4" }))).toThrow(
      "distance_km must be a finite number",
    );
    expect(() => parseRouteDetail(validRouteDetail({ name: 42 }))).toThrow(
      "name must be a string",
    );
    expect(() => parseRouteDetail(validRouteDetail({ replay: { mode: "cinema" } }))).toThrow(
      "replay.mode must be atlas or earth",
    );
  });

  it("parses complete reviewed curation from generated data", () => {
    const route = parseRouteDetail(validRouteDetail());

    expect(route.curation).toEqual({
      vibe: "Quiet lanes opening into a sustained climb.",
      idealUse: "A long, unhurried exploration day.",
      terrain: ["Paved lanes", "Steep hillside roads"],
      difficulty: "Demanding",
      highlights: ["Temple district", "Eastern hills"],
      caveats: ["Expect frequent road crossings"],
      seasonality: "Best in cool, dry weather.",
      editorialNote: "Preserved for its contrast and scale.",
      reviewStatus: "reviewed",
    });
  });

  it("keeps incomplete curation as a sparse draft", () => {
    const route = parseRouteDetail(validRouteDetail({
      curation: {
        vibe: "Riverside miles through the city.",
        review_status: "draft",
      },
    }));

    expect(route.curation).toEqual({
      vibe: "Riverside miles through the city.",
      reviewStatus: "draft",
    });
  });

  it("rejects incomplete reviewed curation", () => {
    expect(() => parseRouteDetail(validRouteDetail({
      curation: {
        vibe: "Riverside miles through the city.",
        review_status: "reviewed",
      },
    }))).toThrow("reviewed curation is missing ideal_use");
  });

  it("rejects unknown curation fields", () => {
    expect(() => parseRouteDetail(validRouteDetail({
      curation: {
        vbie: "Typo that must not disappear silently.",
        review_status: "draft",
      },
    }))).toThrow("curation has unknown fields: vbie");
  });

  it("validates geometry and replay cross-field invariants", () => {
    expect(() => parseRouteDetail(validRouteDetail({ mid_idx: 99 }))).toThrow(
      "mid_idx must reference a route point",
    );
    expect(() => parseRouteDetail(validRouteDetail({
      route: [
        { lat: 51.05, lng: -114.07, elev: 1050, d: 500 },
        { lat: 51.06, lng: -114.08, elev: 1060, d: 100 },
      ],
    }))).not.toThrow();
    const decreasingDistance = parseRouteDetail(validRouteDetail({
      route: [
        { lat: 51.05, lng: -114.07, elev: 1050, d: 500 },
        { lat: 51.06, lng: -114.08, elev: 1060, d: 100 },
      ],
    }));
    expect(decreasingDistance.replay.geometryStatus).toBe("invalid");
    expect(decreasingDistance.replay.replayEligible).toBe(false);
    expect(() => parseRouteDetail(validRouteDetail({
      replay: {
        mode: "atlas",
        replay_eligible: true,
        best_in_earth: true,
        geometry_status: "ready",
      },
    }))).toThrow("best_in_earth replay must use earth mode");
  });
});

describe("parseRouteSummary", () => {
  it("validates every generated summary without embedding full curation", () => {
    const generatedRoutes = (manifest as { routes: unknown[] }).routes;

    expect(generatedRoutes.length).toBeGreaterThan(0);
    for (const generatedRoute of generatedRoutes) {
      expect(generatedRoute).not.toHaveProperty("curation");
      expect(parseRouteSummary(generatedRoute).guide.reviewStatus).toMatch(
        /^(draft|reviewed|published)$/,
      );
    }
  });

  it("keeps the reviewed guide preview equal to its lazy full guide", () => {
    const generatedRoutes = (manifest as { routes: unknown[] }).routes;
    const summary = parseRouteSummary(
      generatedRoutes.find(
        (route) =>
          (route as { slug?: string }).slug === "17654151284",
      ),
    );
    const detail = parseRouteDetail(
      JSON.parse(
        readFileSync(
          new URL("../../public/data/routes/17654151284.json", import.meta.url),
          "utf8",
        ),
      ),
    );

    expect(summary.guide).toEqual({
      vibe: detail.curation.vibe,
      reviewStatus: detail.curation.reviewStatus,
    });
  });

  it("parses the lightweight reviewed guide preview", () => {
    const route = parseRouteSummary({
      slug: "reviewed-route",
      lifecycle: "completed",
      trace: [
        [51.1, -114.1, 1234, 0],
        [51.2, -114.2, 1240, 500],
      ],
      replay: { geometry_status: "ready" },
      guide_preview: {
        vibe: "Quiet lanes opening into a sustained climb.",
        review_status: "reviewed",
      },
    });

    expect(route.guide).toEqual({
      vibe: "Quiet lanes opening into a sustained climb.",
      reviewStatus: "reviewed",
    });
  });

  it("defaults an absent guide preview to an honest draft", () => {
    const route = parseRouteSummary({
      slug: "draft-route",
      lifecycle: "completed",
      trace: [
        [51.1, -114.1, 1234, 0],
        [51.2, -114.2, 1240, 500],
      ],
      replay: { geometry_status: "ready" },
    });

    expect(route.guide).toEqual({ reviewStatus: "draft" });
  });

  it("rejects invalid or dishonest guide previews", () => {
    const summary = {
      slug: "invalid-preview",
      lifecycle: "completed",
      trace: [
        [51.1, -114.1, 1234, 0],
        [51.2, -114.2, 1240, 500],
      ],
      replay: { geometry_status: "ready" },
    };

    expect(() =>
      parseRouteSummary({
        ...summary,
        guide_preview: { review_status: "reviewed" },
      }),
    ).toThrow("reviewed guide_preview is missing vibe");
    expect(() =>
      parseRouteSummary({
        ...summary,
        guide_preview: { review_status: "draft", vbie: "typo" },
      }),
    ).toThrow("guide_preview has unknown fields: vbie");
  });

  it("expands compact generated trace tuples", () => {
    const route = parseRouteSummary({
      slug: "compact-route",
      activity_id: "activity-2",
      lifecycle: "completed",
      name: "Compact route",
      trace: [
        [51.1, -114.1, 1234, 0],
        [51.2, -114.2, 1240, 500],
      ],
      replay: { geometry_status: "ready" },
    });

    expect(route.trace).toEqual([
      { lat: 51.1, lng: -114.1, elev: 1234, d: 0 },
      { lat: 51.2, lng: -114.2, elev: 1240, d: 500 },
    ]);
  });
});

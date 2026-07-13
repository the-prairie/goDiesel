import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";

import { parseRouteDetail, parseRouteSummary } from "@/domain/routes";

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

    expect(files).toHaveLength(66);
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

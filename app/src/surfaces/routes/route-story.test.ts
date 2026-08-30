import { describe, expect, it } from "vitest";

import type { QuestRoute } from "@/domain/route";
import { highestPoint, routeStoryChapters, routeStoryTitle } from "@/surfaces/routes/route-story";

function route(overrides: Partial<QuestRoute> = {}): QuestRoute {
  return {
    slug: "route-1",
    activityId: "route-1",
    lifecycle: "completed",
    name: "Kyoto, Japan",
    subtitle: "",
    activityName: "ridge after rain",
    region: "Kyoto, Japan",
    date: "2026-08-13",
    distanceKm: 10,
    elevationGainM: 420,
    elevationStatus: "recorded",
    type: "Run",
    description: "",
    completionRule: "Complete the route.",
    difficulty: "Demanding",
    theme: "Explore",
    xp: 0,
    route: [
      { lat: 1, lng: 1, elev: 100, d: 0 },
      { lat: 1.1, lng: 1.1, elev: 700, d: 5_000 },
      { lat: 1.2, lng: 1.2, elev: 120, d: 10_000 },
    ],
    midIdx: 1,
    centerLat: 1.1,
    centerLng: 1.1,
    replay: {
      replayMode: "earth",
      replayEligible: true,
      bestInEarth: true,
      geometryStatus: "ready",
    },
    curation: { reviewStatus: "reviewed" },
    annotations: [],
    provenance: {
      temporal: { status: "recorded" },
      elevation: { status: "recorded" },
      track: { segmentCount: 1 },
      discontinuities: [],
    },
    ...overrides,
  };
}

describe("route story chapters", () => {
  it("orders recorded annotations and a derived high point by distance", () => {
    const chapters = routeStoryChapters(
      route({
        annotations: [
          {
            id: "later",
            atDistanceM: 7_000,
            kind: "note",
            evidence: "recorded",
            body: "Later note",
          },
          {
            id: "earlier",
            atDistanceM: 2_000,
            kind: "image",
            evidence: "recorded",
            body: "Earlier photograph",
          },
        ],
      }),
    );

    expect(chapters.map(({ id }) => id)).toEqual([
      "recorded-start",
      "earlier",
      "derived-high-point",
      "later",
      "recorded-finish",
    ]);
    expect(chapters[2]).toMatchObject({ evidence: "derived", elevationM: 700 });
  });

  it("does not invent a separate summit chapter when the finish is highest", () => {
    const chapters = routeStoryChapters(
      route({
        route: [
          { lat: 1, lng: 1, elev: 100, d: 0 },
          { lat: 1.1, lng: 1.1, elev: 200, d: 5_000 },
          { lat: 1.2, lng: 1.2, elev: 800, d: 10_000 },
        ],
      }),
    );

    expect(chapters.some(({ kind }) => kind === "summit")).toBe(false);
  });

  it("uses the place name when the recorded activity title has no words", () => {
    expect(routeStoryTitle(route({ activityName: "🍑🍑🍑" }))).toBe("Kyoto, Japan");
  });

  it("does not present start or finish chapters without recorded GPS geometry", () => {
    expect(routeStoryChapters(route({ route: [] }))).toEqual([]);
  });

  it("describes imported geometry without inventing a completed activity", () => {
    const chapters = routeStoryChapters(route({ lifecycle: "discovered" }));

    expect(chapters[0]?.body).toBe(
      "The imported run route begins in Kyoto, Japan on August 13, 2026.",
    );
    expect(chapters.at(-1)?.body).toBe(
      "The imported route closes after 10.0 km and 420 m of source-recorded climbing.",
    );
  });

  it("does not turn unavailable elevation into a zero-metre story", () => {
    const unavailable = route({
      lifecycle: "discovered",
      elevationStatus: "unavailable",
      elevationGainM: 0,
      route: [
        { lat: 27.98, lng: 86.9, elev: 0, d: 0 },
        { lat: 27.99, lng: 86.91, elev: 0, d: 1_500 },
      ],
      provenance: {
        temporal: { status: "unavailable" },
        elevation: { status: "unavailable" },
        track: { segmentCount: 1 },
        discontinuities: [],
      },
    });
    const chapters = routeStoryChapters(unavailable);

    expect(highestPoint(unavailable)).toBeUndefined();
    expect(chapters.every((chapter) => chapter.elevationM === undefined)).toBe(true);
    expect(chapters.at(-1)?.body).toContain("Elevation is unavailable");
    expect(chapters.at(-1)?.body).not.toContain("0 m");
  });
});

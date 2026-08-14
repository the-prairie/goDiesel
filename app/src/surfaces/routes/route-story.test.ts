import { describe, expect, it } from "vitest";

import type { QuestRoute } from "@/domain/route";
import { routeStoryChapters, routeStoryTitle } from "@/surfaces/routes/route-story";

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
});

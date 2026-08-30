import { describe, expect, it } from "vitest";

import { curatedDiscoveryCandidates } from "@/data/discovery-provider";
import { findRecordedPlanMatches } from "@/domain/plan-completion";
import type { PlannedRoute } from "@/domain/planning";
import type { RouteSummary } from "@/domain/route";

const source = curatedDiscoveryCandidates.find(
  (candidate) => candidate.sourceRouteSlug === "13358070690",
)!.route;

function plan(): PlannedRoute {
  return {
    ...source,
    slug: "planned-owner-route-13358070690",
    activityId: "planned:owner-route-13358070690",
    lifecycle: "planned",
    date: "2024-10-01",
    replay: { ...source.replay, replayEligible: false, bestInEarth: false },
    planning: {
      candidateId: "owner-route-13358070690",
      sourceRouteSlug: source.slug,
      sourceLabel: "Owner-curated from recorded GPX",
      createdAt: "2024-10-01T12:00:00.000Z",
      storeVersion: 1,
      intent: {
        place: "Banff",
        activity: "Run",
        distanceKm: 21,
        terrain: "trail",
        vibe: "big mountain day",
      },
    },
  };
}

function recorded(overrides: Partial<RouteSummary> = {}): RouteSummary {
  return {
    ...source,
    slug: "recorded-after-plan",
    activityId: "recorded-after-plan",
    lifecycle: "completed",
    date: "2025-05-24",
    distanceKm: 22,
    trace: source.trace.map((point) => ({ ...point, lat: point.lat + 0.001 })),
    ...overrides,
  };
}

describe("recorded plan matching", () => {
  it("offers a later recorded activity with matching facts and overlapping geometry", () => {
    const [match] = findRecordedPlanMatches(plan(), [recorded()]);

    expect(match.route.slug).toBe("recorded-after-plan");
    expect(match.evidence).toBe("derived");
    expect(match.distanceDeltaKm).toBe(1);
    expect(match.overlapRatio).toBeGreaterThan(0.9);
  });

  it("rejects the planning source, older activities, distant geometry, and other regions", () => {
    const candidates = [
      recorded({ slug: source.slug }),
      recorded({ slug: "recorded-before-plan", date: "2024-09-30" }),
      recorded({
        slug: "recorded-far-away",
        trace: source.trace.map((point) => ({ ...point, lat: point.lat + 8 })),
      }),
      recorded({ slug: "recorded-other-region", region: "Tokyo, Japan" }),
    ];

    expect(findRecordedPlanMatches(plan(), candidates)).toEqual([]);
  });

  it("orders stronger spatial matches before weaker candidates", () => {
    const strong = recorded({ slug: "strong", distanceKm: 23 });
    const weaker = recorded({
      slug: "weaker",
      distanceKm: 21,
      trace: source.trace.map((point, index) => ({
        ...point,
        lat: point.lat + (index % 5 === 0 ? 0.02 : 0.001),
      })),
    });

    expect(findRecordedPlanMatches(plan(), [weaker, strong]).map((match) => match.route.slug))
      .toEqual(["strong", "weaker"]);
  });

  it("rejects a route that shares only a short segment with the planning trace", () => {
    const shortSharedSegment = recorded({
      slug: "short-shared-segment",
      trace: source.trace.map((point, index) => ({
        ...point,
        lat: point.lat + (index < source.trace.length * 0.2 ? 0.001 : 0.04),
      })),
    });

    expect(findRecordedPlanMatches(plan(), [shortSharedSegment])).toEqual([]);
  });
});

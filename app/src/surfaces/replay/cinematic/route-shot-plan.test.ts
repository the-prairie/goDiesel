import { describe, expect, it } from "vitest";

import type { QuestRoute } from "@/domain/route";
import {
  cinematicDuration,
  cinematicFrame,
  cinematicShotPlan,
} from "@/surfaces/replay/cinematic/route-cinematic-director";

/** 12 km with a relief bump in the middle and one recording gap. */
function route(gaps: { startD: number; endD: number }[] = []): QuestRoute {
  const points = Array.from({ length: 61 }, (_, index) => {
    const d = index * 200;
    return {
      lat: 50 + d / 111_000,
      lng: -115 + Math.sin(index / 6) * 0.01,
      elev: 1_400 + Math.max(0, 600 - Math.abs(d - 6_000) / 5),
      d,
    };
  });
  return {
    slug: "fixture",
    distanceKm: 12,
    centerLat: 50.05,
    centerLng: -115,
    region: "Fixture",
    route: points,
    provenance: {
      temporal: { status: "recorded" },
      track: { segmentCount: 1 },
      discontinuities: gaps.map((gap) => ({ kind: "missing_position_records", source: "recorded_position_absence", ...gap })),
    },
  } as unknown as QuestRoute;
}

describe("cinematicShotPlan", () => {
  it("is reproducible: the same inputs give the same plan and digest", () => {
    const first = cinematicShotPlan(route(), "feature");
    const second = cinematicShotPlan(route(), "feature");
    expect(second.digest).toBe(first.digest);
    expect(second.shots).toEqual(first.shots);
  });

  it("explains every shot and places it in recorded metres", () => {
    const plan = cinematicShotPlan(route(), "feature");
    expect(plan.shots.length).toBeGreaterThan(3);
    for (const shot of plan.shots) {
      expect(shot.reason.length).toBeGreaterThan(8);
      expect(shot.fromM).toBeGreaterThanOrEqual(0);
      expect(shot.toM).toBeLessThanOrEqual(12_000);
    }
    expect(plan.durationSeconds).toBeCloseTo(cinematicDuration(route(), "feature"), 6);
  });

  it("lets owner chapters choose the hero moments", () => {
    const anchors = [
      { id: "saddle", title: "The saddle", atDistanceM: 2_400 },
      { id: "top", title: "The top", atDistanceM: 9_600 },
    ];
    const plan = cinematicShotPlan(route(), "feature", anchors);
    const anchored = plan.shots.filter((shot) => shot.anchorId);
    expect(anchored.map((shot) => shot.anchorId)).toEqual(expect.arrayContaining(["saddle", "top"]));
    const top = anchored.find((shot) => shot.anchorId === "top")!;
    expect((top.fromM + top.toM) / 2).toBeCloseTo(9_600, -2);
    expect(top.reason).toMatch(/The top/);
    expect(plan.digest).not.toBe(cinematicShotPlan(route(), "feature").digest);
  });

  it("does not repeat one chapter across every hero shot", () => {
    const plan = cinematicShotPlan(route(), "feature", [{ id: "only", title: "Only", atDistanceM: 9_600 }]);
    expect(plan.shots.filter((shot) => shot.anchorId === "only")).toHaveLength(1);
  });

  it("keeps each shot's travel on one side of a recording gap", () => {
    const gaps = [{ startD: 5_800, endD: 6_400 }];
    const anchors = [{ id: "edge", title: "Edge", atDistanceM: 6_500 }];
    for (const cut of ["feature", "kinetic", "intimate", "monumental"] as const) {
      const plan = cinematicShotPlan(route(gaps), cut, anchors);
      for (const shot of plan.shots) {
        const low = Math.min(shot.fromM, shot.toM);
        const high = Math.max(shot.fromM, shot.toM);
        expect(low < 6_400 && high > 5_800, `${cut} ${shot.kind} ${low}-${high}`).toBe(false);
      }
    }
  });

  it("renders the anchored plan it reports", () => {
    const anchors = [{ id: "top", title: "The top", atDistanceM: 9_600 }];
    const plan = cinematicShotPlan(route(), "feature", anchors);
    const shotIndex = plan.shots.findIndex((shot) => shot.anchorId === "top");
    const middle = (plan.shots[shotIndex].startSeconds + plan.shots[shotIndex].endSeconds) / 2;
    const frame = cinematicFrame(route(), "feature", middle, anchors);
    expect(frame.shotIndex).toBe(shotIndex);
    expect(frame.routeProgressM).toBeCloseTo(9_600, -2);
  });
});

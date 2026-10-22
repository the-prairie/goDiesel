import { describe, expect, it } from "vitest";

import { courseStats, type CoursePoint } from "@/domain/courses";
import { assessCandidate, parseCourseAssessment, rankCandidates, type GeographicContext, type RouteCandidate } from "@/domain/course-planning";

const geography: GeographicContext = {
  status: "available",
  bounds: { west: -1, south: -1, east: 1, north: 1 },
  parks: [],
  water: [],
  waterways: [],
};
const unavailable: GeographicContext = { ...geography, status: "unavailable" };

function candidate(points: CoursePoint[], surface: RouteCandidate["surface"] = [], waytype: RouteCandidate["waytype"] = []): RouteCandidate {
  return { points, surface, waytype };
}

function line(length = 0.01, lat = 0, elevation = 0): RouteCandidate {
  return candidate([{ lng: 0, lat, elevationM: 0 }, { lng: length, lat, elevationM: elevation }]);
}

function measured(route: RouteCandidate, context = geography) {
  return { candidate: route, assessment: assessCandidate(route, context) };
}

function box(west: number, south: number, east: number, north: number): [number, number][] {
  return [[west, south], [east, south], [east, north], [west, north], [west, south]];
}

describe("mapped course assessment", () => {
  it("retains unknown data and uses the course's distance and ascent definition", () => {
    const route = candidate([{ lat: 0, lng: 0, elevationM: 1 }, { lat: 0, lng: 0.01 }]);
    const assessment = assessCandidate(route, unavailable);
    expect(assessment.distanceM).toBe(courseStats([route.points]).distanceM);
    expect(assessment.ascentM).toBeNull();
    for (const metric of [assessment.parks, assessment.waterfront, assessment.paved, assessment.quietEstimate]) {
      expect(metric).toEqual({ matchedM: 0, knownM: 0, unknownM: assessment.distanceM, share: null });
    }
  });

  it("weights metadata by segment distance, uses exclusive ends, and counts overlapping intervals once", () => {
    const route = candidate(
      [{ lng: 0, lat: 0 }, { lng: 0.009, lat: 0 }, { lng: 0.01, lat: 0 }],
      [{ from: 0, to: 1, kind: "paved" }, { from: 0, to: 1, kind: "paved" }, { from: 1, to: 2, kind: "unpaved" }],
      [{ from: 0, to: 1, kind: "path" }, { from: 1, to: 2, kind: "road" }],
    );
    const assessment = assessCandidate(route, geography);
    expect(assessment.paved.share).toBeCloseTo(0.9, 6);
    expect(assessment.quietEstimate.share).toBeCloseTo(0.9, 6);
    expect(assessment.paved.unknownM).toBeCloseTo(0, 6);
    route.surface.push({ from: 0, to: 1, kind: "unpaved" });
    const conflicting = assessCandidate(route, geography).paved;
    expect(conflicting.share).toBe(0);
    expect(conflicting.unknownM / assessment.distanceM).toBeCloseTo(0.9, 6);
  });

  it("counts overlapping parks once and excludes holes", () => {
    const outer = box(-0.001, -0.001, 0.011, 0.001);
    const hole = box(0.004, -0.0005, 0.006, 0.0005);
    const assessment = assessCandidate(line(), {
      ...geography,
      parks: [{ rings: [outer, hole] }, { rings: [outer, hole] }],
    });
    expect(assessment.parks.share).toBeCloseTo(0.8, 1);
    expect(assessment.parks.matchedM).toBeLessThan(assessment.distanceM);
    expect(assessment.parks.knownM).toBeCloseTo(assessment.distanceM, 6);
  });

  it("returns the same mapped estimate for dense and sparse encodings", () => {
    const context = { ...geography, parks: [{ rings: [box(0.002, -0.001, 0.007, 0.001)] }] };
    const dense = candidate(Array.from({ length: 1001 }, (_, index) => ({ lat: 0, lng: index / 100_000 })));
    const sparse = line();
    const first = assessCandidate(dense, context);
    const second = assessCandidate(sparse, context);
    expect(first.parks.share).toBeCloseTo(second.parks.share!, 8);
    expect(first.parks.matchedM).toBeCloseTo(second.parks.matchedM, 6);
  });

  it("measures waterfront from polygon boundaries and lines within 75 meters", () => {
    const water = [{ rings: [box(-0.1, 0.0005, 0.1, 0.1)] }];
    expect(assessCandidate(line(), { ...geography, water }).waterfront.share).toBeCloseTo(1, 8);
    expect(assessCandidate(line(0.01, 0.05), { ...geography, water }).waterfront.share).toBe(0);
    expect(assessCandidate(line(), { ...geography, waterways: [[[-0.1, 0.0005], [0.1, 0.0005]]] }).waterfront.share).toBeCloseTo(1, 8);
    expect(assessCandidate(line(), { ...geography, waterways: [[[-0.1, 0.001], [0.1, 0.001]]] }).waterfront.share).toBe(0);
  });

  it("does not infer absence outside the query bounds or from a partial response", () => {
    const bounded = assessCandidate(line(), { ...geography, bounds: { west: -1, south: -1, east: 0.005, north: 1 } });
    expect(bounded.parks.knownM / bounded.distanceM).toBeCloseTo(0.5, 1);
    expect(bounded.waterfront.knownM).toBeLessThan(bounded.parks.knownM);
    const partial = assessCandidate(line(), { ...geography, status: "partial", parks: [{ rings: [box(-1, -1, 0.005, 1)] }] });
    expect(partial.parks.share).toBe(1);
    expect(partial.parks.unknownM / partial.distanceM).toBeCloseTo(0.5, 1);
    expect(partial.waterfront.share).toBeNull();
  });

  it("bounds geography work without treating omitted geometry as a measured absence", () => {
    const assessment = assessCandidate(line(), { ...geography, waterways: [Array.from({ length: 20_001 }, () => [0, 0] as [number, number])] });
    expect(assessment.geographyStatus).toBe("unavailable");
    expect(assessment.waterfront.share).toBeNull();
  });
});

describe("candidate ranking", () => {
  it("deduplicates reverse loops even when one has extra geometry points", () => {
    const loop = candidate([{ lat: 0, lng: 0 }, { lat: 0, lng: 0.01 }, { lat: 0.01, lng: 0.01 }, { lat: 0, lng: 0 }]);
    const reverse = candidate([...loop.points].reverse());
    reverse.points.splice(3, 0, { lat: 0, lng: 0.005 });
    const result = rankCandidates([measured(loop), measured(reverse)], courseStats([loop.points]).distanceM, [], "any");
    expect(result.uniqueCount).toBe(1);
    expect(result.comparedCount).toBe(1);
    expect(result.duplicateCount).toBe(1);
    expect(result.ranked[0].candidate).toBe(loop);
  });

  it("places preferred distance before preferences, allows fallback, and rejects over 30 percent", () => {
    const preferred = line();
    const fallback = line(0.012, 0.001);
    fallback.surface = [{ from: 0, to: 1, kind: "paved" }];
    preferred.surface = [{ from: 0, to: 1, kind: "unpaved" }];
    const rejected = line(0.014, 0.002);
    const target = courseStats([preferred.points]).distanceM;
    const result = rankCandidates([measured(fallback), measured(rejected), measured(preferred)], target, ["paved"], "any");
    expect(result.ranked.map((item) => item.candidate)).toEqual([preferred, fallback]);
    expect(result.rejectedCount).toBe(1);
    expect(result.comparedCount).toBe(2);
    expect(result.ranked.map((item) => item.assessment.selection?.distanceBand)).toEqual(["preferred", "fallback"]);
  });

  it("uses mapped preferences and hills to order otherwise eligible routes", () => {
    const road = line(0.01, 0, 10);
    const path = line(0.01, 0.002, 100);
    road.waytype = [{ from: 0, to: 1, kind: "road" }];
    path.waytype = [{ from: 0, to: 1, kind: "path" }];
    const routes = [measured(road), measured(path)];
    const target = routes[0].assessment.distanceM;
    expect(rankCandidates(routes, target, ["quiet"], "any").ranked[0].candidate).toBe(path);
    expect(rankCandidates(routes, target, [], "less").ranked[0].candidate).toBe(road);
    expect(rankCandidates(routes, target, [], "more").ranked[0].candidate).toBe(path);
    const context = { ...geography, parks: [{ rings: [box(-1, 0.001, 1, 0.003)] }] };
    expect(rankCandidates([measured(road, context), measured(path, context)], target, ["green"], "any").ranked[0].candidate).toBe(path);
  });

  it("ignores incomparable coverage rather than letting unknown data win a preference", () => {
    const known = line();
    known.surface = [{ from: 0, to: 1, kind: "unpaved" }];
    const unknown = line(0.01, 0.002);
    delete unknown.points[1].elevationM;
    const result = rankCandidates([measured(known), measured(unknown)], courseStats([known.points]).distanceM, ["paved"], "less");
    expect(result.usedDimensions).toEqual([]);
    expect(result.ignoredDimensions).toEqual(["paved", "ascent"]);
    expect(result.ranked[0].candidate).toBe(known);
    expect(result.ranked.every((item) => item.assessment.selection?.score === 0)).toBe(true);
  });

  it("ignores substantially different coverage even when both have mostly mapped surfaces", () => {
    const complete = candidate([{ lng: 0, lat: 0 }, { lng: 0.0085, lat: 0 }, { lng: 0.01, lat: 0 }], [{ from: 0, to: 1, kind: "paved" }, { from: 1, to: 2, kind: "unpaved" }]);
    const partial = candidate([{ lng: 0, lat: 0.002 }, { lng: 0.008, lat: 0.002 }, { lng: 0.01, lat: 0.002 }], [{ from: 0, to: 1, kind: "paved" }]);
    const result = rankCandidates([measured(partial), measured(complete)], courseStats([complete.points]).distanceM, ["paved"], "any");
    expect(result.ignoredDimensions).toEqual(["paved"]);
    expect(result.ranked[0].candidate).toBe(complete);
  });

  it("scores confirmed distance rather than inflating a partially mapped positive share", () => {
    const complete = candidate([{ lng: 0, lat: 0 }, { lng: 0.0096, lat: 0 }, { lng: 0.01, lat: 0 }], [{ from: 0, to: 1, kind: "paved" }, { from: 1, to: 2, kind: "unpaved" }]);
    const partial = candidate([{ lng: 0, lat: 0.002 }, { lng: 0.0095, lat: 0.002 }, { lng: 0.01, lat: 0.002 }], [{ from: 0, to: 1, kind: "paved" }]);
    const result = rankCandidates([measured(partial), measured(complete)], courseStats([complete.points]).distanceM, ["paved"], "any");
    expect(result.usedDimensions).toEqual(["paved"]);
    expect(result.ranked[0].candidate).toBe(complete);
    expect(result.ranked[0].assessment.selection?.score).toBeCloseTo(0.96, 6);
    expect(result.ranked[1].assessment.paved.share).toBe(1);
    expect(result.ranked[1].assessment.selection?.score).toBeCloseTo(0.95, 6);
  });

  it("reports a lone candidate honestly and returns no rejected fallback as a winner", () => {
    const route = measured(line());
    const single = rankCandidates([route], route.assessment.distanceM, ["green"], "any");
    expect(single.comparedCount).toBe(1);
    expect(single.usedDimensions).toEqual([]);
    expect(single.ranked[0].assessment.selection?.score).toBe(0);
    const rejected = rankCandidates([route], 100, [], "any");
    expect(rejected.ranked).toEqual([]);
    expect(rejected.rejectedCount).toBe(1);
  });

  it("compares evidence within the preferred distance band even if a fallback has missing data", () => {
    const road = line();
    road.waytype = [{ from: 0, to: 1, kind: "road" }];
    const path = line(0.01, 0.002);
    path.waytype = [{ from: 0, to: 1, kind: "path" }];
    const fallback = line(0.012, 0.004);
    const result = rankCandidates([measured(road), measured(fallback), measured(path)], courseStats([road.points]).distanceM, ["quiet"], "any");
    expect(result.usedDimensions).toEqual(["quietEstimate"]);
    expect(result.ranked.map((item) => item.candidate)).toEqual([path, road, fallback]);
  });
});

describe("persisted assessment validation", () => {
  it("round trips assessment and selection metadata", () => {
    const route = measured(line());
    const assessment = rankCandidates([route], route.assessment.distanceM, ["quiet"], "any").ranked[0].assessment;
    expect(parseCourseAssessment(JSON.parse(JSON.stringify(assessment)))).toEqual(assessment);
  });

  it.each([
    { version: 2 },
    { distanceM: Number.NaN },
    { ascentM: -1 },
    { geographyStatus: "invented" },
    { paved: { matchedM: 10, knownM: 0, unknownM: 100, share: 1 } },
    { parks: { matchedM: 0, knownM: 0, unknownM: 0, share: 0 } },
    { selection: { requestedCount: 1 } },
  ])("rejects invalid persisted assessment fields %j", (patch) => {
    expect(() => parseCourseAssessment({ ...assessCandidate(line(), geography), ...patch })).toThrow();
  });

  it("rejects impossible comparison counts and false coverage", () => {
    const route = measured(line());
    const assessment = rankCandidates([route], route.assessment.distanceM, [], "any").ranked[0].assessment;
    expect(() => parseCourseAssessment({ ...assessment, selection: { ...assessment.selection, comparedCount: 2 } })).toThrow();
    expect(() => parseCourseAssessment({ ...assessment, geographyStatus: "unavailable" })).toThrow();
  });
});

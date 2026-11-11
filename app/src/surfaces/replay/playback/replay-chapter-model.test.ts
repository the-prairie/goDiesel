import { describe, expect, it } from "vitest";

import type { QuestRoute } from "@/domain/route";
import {
  buildReplayChapterModel,
  replayChapterAt,
  replayElevationAt,
  replayProfileInSpan,
} from "@/surfaces/replay/playback/replay-chapter-model";

function route(
  samples: [number, number][],
  distanceM = samples.at(-1)?.[0] ?? 0,
  discontinuities: QuestRoute["provenance"]["discontinuities"] = [],
): QuestRoute {
  return {
    distanceKm: distanceM / 1_000,
    route: samples.map(([d, elev]) => ({ d, elev, lat: 51, lng: -114 })),
    provenance: {
      temporal: { status: "unavailable" },
      track: { segmentCount: discontinuities.length + 1 },
      discontinuities,
    },
  } as QuestRoute;
}

describe("Replay chapter model", () => {
  it("uses the session distance without extending recorded elevation", () => {
    const model = buildReplayChapterModel(route([[100, 50], [500, 70], [900, 90]], 4_000));
    expect(model.totalDistanceM).toBe(4_000);
    expect(model.chapters.map(({ startM, endM }) => [startM, endM])).toEqual([
      [0, 1_000], [1_000, 2_000], [2_000, 3_000], [3_000, 4_000],
    ]);
    expect(model.chapters.map(({ label }) => label)).toEqual(["Opening", "Section 2", "Section 3", "Finish"]);
    expect(replayElevationAt(model, 0)).toBeUndefined();
    expect(replayElevationAt(model, 100)).toBe(50);
    expect(replayElevationAt(model, 300)).toBe(60);
    expect(replayElevationAt(model, 900)).toBe(90);
    expect(replayElevationAt(model, 901)).toBeUndefined();
    expect(replayElevationAt(model, 4_000)).toBeUndefined();
    expect(replayProfileInSpan(model, { startM: 0, endM: 4_000 }).flat().map((point) => point.distanceM)).toEqual([100, 500, 900]);
  });

  it("uses the recorded endpoint when the activity distance is shorter", () => {
    const model = buildReplayChapterModel(route([[0, 10], [5_000, 20]], 4_000));
    expect(model.totalDistanceM).toBe(5_000);
    expect(model.chapters.at(-1)?.endM).toBe(5_000);
  });

  it("collapses a short route and keeps flat chapters neutral", () => {
    const short = buildReplayChapterModel(route([[0, 50], [100, 50], [200, 50]]));
    expect(short.chapters).toEqual([{
      id: "chapter-1", index: 0, startM: 0, endM: 200, label: "Opening / Finish", ascentM: 0, descentM: 0,
    }]);
    expect(short.moments).toEqual([]);
    const long = buildReplayChapterModel(route([[0, 50], [2_000, 50], [4_000, 50]]));
    expect(long.chapters.map(({ label }) => label)).toEqual(["Opening", "Level", "Level", "Finish"]);
    expect(long.moments).toEqual([]);
  });

  it("derives terrain labels and chapter totals from continuous elevation changes", () => {
    const model = buildReplayChapterModel(route([
      [0, 100], [1_000, 100], [1_500, 130], [2_000, 160], [2_500, 130], [3_000, 100], [4_000, 100],
    ]));
    expect(model.chapters.map(({ label }) => label)).toEqual(["Opening", "Climbing", "Descending", "Finish"]);
    expect(model.chapters[1]).toMatchObject({ ascentM: 60, descentM: 0 });
    expect(model.chapters[2]).toMatchObject({ ascentM: 0, descentM: 60 });
    const rolling = buildReplayChapterModel(route([[0, 100], [1_000, 100], [1_500, 130], [2_000, 100], [4_000, 100]]));
    expect(rolling.chapters[1]).toMatchObject({ label: "Rolling", ascentM: 30, descentM: 30 });
  });

  it("divides an edge's elevation change accurately at chapter boundaries", () => {
    const model = buildReplayChapterModel(route([[0, 100], [4_000, 180]]));
    expect(model.chapters.map(({ ascentM, descentM }) => [ascentM, descentM])).toEqual([[20, 0], [20, 0], [20, 0], [20, 0]]);
  });

  it("selects the chapter after a boundary and keeps the finish active", () => {
    const model = buildReplayChapterModel(route([[0, 100], [4_000, 100]]));
    expect(replayChapterAt(model, 0)?.label).toBe("Opening");
    expect(replayChapterAt(model, 999)?.index).toBe(0);
    expect(replayChapterAt(model, 1_000)?.index).toBe(1);
    expect(replayChapterAt(model, 4_000)?.label).toBe("Finish");
    expect(replayChapterAt(model, 4_001)?.label).toBe("Finish");
    expect(replayChapterAt(model, NaN)).toBeUndefined();
  });

  it.each([
    ["segment_boundary", "recorded_track_segment"],
    ["recording_gap", "recorded_timestamps"],
    ["missing_position_records", "recorded_position_absence"],
  ] as const)("keeps %s out of profiles, lookups, totals and descents", (kind, source) => {
    const model = buildReplayChapterModel(route([
      [0, 200], [500, 190], [1_000, 180], [2_000, 100], [2_500, 90], [3_000, 80],
    ], 3_000, [{ kind, source, startD: 1_000, endD: 2_000 }]));
    expect(model.segments.map((segment) => segment.map((point) => point.distanceM))).toEqual([[0, 500, 1_000], [2_000, 2_500, 3_000]]);
    expect(replayElevationAt(model, 1_500)).toBeUndefined();
    expect(replayElevationAt(model, 1_000)).toBe(180);
    expect(replayElevationAt(model, 2_000)).toBe(100);
    expect(replayProfileInSpan(model, { startM: 750, endM: 2_250 })).toEqual([
      [{ distanceM: 750, elevationM: 185 }, { distanceM: 1_000, elevationM: 180 }],
      [{ distanceM: 2_000, elevationM: 100 }, { distanceM: 2_250, elevationM: 95 }],
    ]);
    expect(replayProfileInSpan(model, { startM: 1_100, endM: 1_900 })).toEqual([]);
    expect(model.chapters.reduce((sum, chapter) => sum + chapter.descentM, 0)).toBe(40);
    expect(model.moments.find((moment) => moment.kind === "descent")).toMatchObject({ startM: 0, endM: 1_000, valueM: 20 });
  });

  it("breaks at zero-width boundaries without inventing a sample", () => {
    const model = buildReplayChapterModel(route([[0, 100], [100, 80], [200, 60], [300, 40]], 300, [
      { kind: "segment_boundary", source: "recorded_track_segment", startD: 100, endD: 100 },
    ]));
    expect(model.segments.map((segment) => segment.map((point) => point.distanceM))).toEqual([[0], [100, 200, 300]]);
    expect(replayElevationAt(model, 50)).toBeUndefined();
    expect(model.moments.find((moment) => moment.kind === "descent")).toMatchObject({ startM: 100, endM: 300, valueM: 40 });
  });

  it("handles overlapping unsorted gaps and samples inside a declared gap", () => {
    const model = buildReplayChapterModel(route([[0, 100], [100, 90], [200, 80], [300, 70], [400, 60]], 400, [
      { kind: "recording_gap", source: "recorded_timestamps", startD: 200, endD: 350 },
      { kind: "recording_gap", source: "recorded_timestamps", startD: 50, endD: 250 },
    ]));
    expect(model.segments).toHaveLength(5);
    expect(replayElevationAt(model, 150)).toBeUndefined();
    expect(model.moments).toEqual([]);
  });

  it("does not treat widely spaced recorded samples as a gap", () => {
    const model = buildReplayChapterModel(route([[0, 100], [10_000, 90], [20_000, 80]]));
    expect(model.segments).toHaveLength(1);
    expect(replayElevationAt(model, 5_000)).toBe(95);
    expect(model.moments.find((moment) => moment.kind === "descent")).toMatchObject({ startM: 0, endM: 20_000, valueM: 20 });
  });

  it("deduplicates identical samples but breaks zero-distance continuity", () => {
    const model = buildReplayChapterModel(route([[0, 100], [100, 90], [100, 90], [200, 80], [300, 70]]));
    expect(model.segments.map((segment) => segment.map((point) => point.distanceM))).toEqual([[0, 100], [200, 300]]);
    expect(model.segments.flat().filter((point) => point.distanceM === 100)).toHaveLength(1);
    expect(replayElevationAt(model, 150)).toBeUndefined();
    expect(model.chapters[0].descentM).toBe(20);
    expect(model.moments.find((moment) => moment.kind === "descent")).toBeUndefined();
  });

  it("preserves different elevations at equal distances without drawing a vertical jump", () => {
    const model = buildReplayChapterModel(route([[0, 100], [100, 90], [100, 300], [200, 290], [300, 280]]));
    expect(model.minimumElevationM).toBe(90);
    expect(model.maximumElevationM).toBe(300);
    expect(replayElevationAt(model, 100)).toBeUndefined();
    expect(model.segments.map((segment) => segment.map((point) => point.elevationM))).toEqual([[100, 90], [300, 290, 280]]);
    expect(replayProfileInSpan(model, { startM: 0, endM: 300 }).every((segment) => segment.every((point, index) => index === 0 || point.distanceM > segment[index - 1].distanceM))).toBe(true);
    expect(model.chapters[0]).toMatchObject({ ascentM: 0, descentM: 30 });
    expect(model.moments.find((moment) => moment.kind === "descent")).toMatchObject({ startM: 100, endM: 300, valueM: 20 });
  });

  it("breaks decreasing distances and refuses ambiguous overlapping elevation", () => {
    const model = buildReplayChapterModel(route([[0, 100], [200, 90], [100, 80], [300, 70], [400, 60]]));
    expect(model.segments.map((segment) => segment.map((point) => point.distanceM))).toEqual([[0, 200], [100, 300, 400]]);
    expect(replayElevationAt(model, 150)).toBeUndefined();
    expect(replayElevationAt(model, 350)).toBe(65);
    expect(model.moments.find((moment) => moment.kind === "descent")).toMatchObject({ startM: 100, endM: 400, valueM: 20 });
  });

  it("anchors extrema at actual samples and clips their windows to their recorded segment", () => {
    const model = buildReplayChapterModel(route([
      [0, 100], [100, 150], [200, 100], [800, 80], [900, 50], [1_000, 80],
    ], 10_000, [{ kind: "recording_gap", source: "recorded_timestamps", startD: 200, endD: 800 }]));
    expect(model.moments.find((moment) => moment.kind === "high-point")).toMatchObject({ startM: 0, endM: 200, anchorM: 100, valueM: 150 });
    expect(model.moments.find((moment) => moment.kind === "low-point")).toMatchObject({ startM: 800, endM: 1_000, anchorM: 900, valueM: 50 });
    expect(model.moments.every((moment) => moment.explanation.includes("Derived from recorded elevation."))).toBe(true);
    expect(model.moments.find((moment) => moment.kind === "high-point")?.explanation).toContain("150.0 m at 0.10 km");
  });

  it("chooses the earliest equal extrema and descent and stops a descent at a rise", () => {
    const source = route([[0, 100], [100, 90], [200, 80], [300, 100], [400, 90], [500, 80]]);
    const model = buildReplayChapterModel(source);
    expect(model.moments.find((moment) => moment.kind === "descent")).toMatchObject({ startM: 0, endM: 200, valueM: 20 });
    expect(model.moments.find((moment) => moment.kind === "high-point")?.anchorM).toBe(0);
    expect(model.moments.find((moment) => moment.kind === "low-point")?.anchorM).toBe(200);
    expect(buildReplayChapterModel(source)).toEqual(model);
  });

  it.each(([
    [], [[0, 100]], [[0, 100], [100, 80]], [[0, 100], [100, 99], [200, 98]],
    [[0, 100], [0, 80], [0, 60]],
  ] as [number, number][][]).map((samples) => ({ samples })))("omits moments when recorded variation or continuity is insufficient", ({ samples }) => {
    expect(buildReplayChapterModel(route(samples)).moments).toEqual([]);
  });

  it("does not turn elevation differences across flat disconnected sections into moments", () => {
    const model = buildReplayChapterModel(route([[0, 100], [100, 100], [200, 100], [300, 50], [400, 50], [500, 50]], 500, [
      { kind: "recording_gap", source: "recorded_timestamps", startD: 200, endD: 300 },
    ]));
    expect(model.moments).toEqual([]);
  });

  it("keeps an empty model finite and draws no profile", () => {
    const model = buildReplayChapterModel(route([]));
    expect(model).toMatchObject({ totalDistanceM: 1, minimumElevationM: 0, maximumElevationM: 0, segments: [], moments: [] });
    expect(replayElevationAt(model, 0)).toBeUndefined();
    expect(replayProfileInSpan(model, { startM: 0, endM: 1 })).toEqual([]);
  });

  it("bounds drawing samples while retaining exact extrema and all gap boundaries", () => {
    const samples: [number, number][] = Array.from({ length: 20_001 }, (_, index) => [index, 100 + Math.sin(index)]);
    samples[1_234][1] = 1_000;
    samples[17_890][1] = -500;
    const model = buildReplayChapterModel(route(samples, 20_000, [
      { kind: "recording_gap", source: "recorded_timestamps", startD: 9_999, endD: 10_000 },
    ]));
    const profile = replayProfileInSpan(model, { startM: 0, endM: 20_000 });
    expect(profile).toHaveLength(2);
    expect(profile.flat().length).toBeLessThanOrEqual(240);
    expect(profile.map((segment) => [segment[0].distanceM, segment.at(-1)!.distanceM])).toEqual([[0, 9_999], [10_000, 20_000]]);
    expect(profile.flat()).toContainEqual({ distanceM: 1_234, elevationM: 1_000 });
    expect(profile.flat()).toContainEqual({ distanceM: 17_890, elevationM: -500 });
    expect(model.moments.find((moment) => moment.kind === "high-point")?.anchorM).toBe(1_234);
    expect(model.moments.find((moment) => moment.kind === "low-point")?.anchorM).toBe(17_890);
    expect(replayElevationAt(model, 1_233)).toBe(samples[1_233][1]);
  });

  it("keeps every separate recorded section when mandatory boundaries exceed the drawing target", () => {
    const samples: [number, number][] = Array.from({ length: 1_000 }, (_, index) => [index, 100]);
    const gaps: QuestRoute["provenance"]["discontinuities"] = Array.from({ length: 499 }, (_, index) => ({
      kind: "segment_boundary", source: "recorded_track_segment", startD: index * 2 + 1, endD: index * 2 + 2,
    }));
    const model = buildReplayChapterModel(route(samples, 1_000, gaps));
    const profile = replayProfileInSpan(model, { startM: 0, endM: 1_000 });
    expect(profile).toHaveLength(500);
    expect(profile.every((segment) => segment.length === 2)).toBe(true);
  });

  it("clips exact and interpolated span boundaries without mutation", () => {
    const source = route([[0, 100], [100, 150], [200, 100]]);
    const before = structuredClone(source);
    const model = buildReplayChapterModel(source);
    expect(replayProfileInSpan(model, { startM: 50, endM: 150 })).toEqual([[
      { distanceM: 50, elevationM: 125 }, { distanceM: 100, elevationM: 150 }, { distanceM: 150, elevationM: 125 },
    ]]);
    expect(replayProfileInSpan(model, { startM: 100, endM: 100 })).toEqual([[{ distanceM: 100, elevationM: 150 }]]);
    expect(replayProfileInSpan(model, { startM: 200, endM: 100 })).toEqual([]);
    expect(replayProfileInSpan(model, { startM: NaN, endM: 200 })).toEqual([]);
    expect(replayElevationAt(model, NaN)).toBeUndefined();
    expect(source).toEqual(before);
  });
});

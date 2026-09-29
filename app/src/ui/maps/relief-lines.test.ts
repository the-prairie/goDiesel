import { describe, expect, it } from "vitest";

import { parseRouteSummary } from "@/domain/route";
import { reliefHistoryLines } from "@/ui/maps/relief-lines";

const trace = [
  [50, -115, 1000, 0],
  [50.01, -115, 1010, 1_000],
  [50.02, -115, 1020, 2_000],
  [50.05, -115, 1030, 9_000],
  [50.06, -115, 1040, 10_000],
];
const summary = (extra: Record<string, unknown> = {}) =>
  parseRouteSummary({ slug: "neighbour", activity_id: "neighbour", name: "N", region: "R", date: "", distance_km: 10, type: "Run", trace, ...extra });

describe("overview gaps", () => {
  const gap = { kind: "missing_position_records", source: "recorded_position_absence", start_d: 2_000, end_d: 9_000 };

  it("summaries carry recorded gaps when the generator provides them", () => {
    expect(summary({ discontinuities: [gap] }).discontinuities).toEqual([
      { kind: "missing_position_records", source: "recorded_position_absence", startD: 2_000, endD: 9_000 },
    ]);
    expect(summary().discontinuities).toBeUndefined();
  });

  it("a malformed gap list is unknown, not an error, in the lenient summary tier", () => {
    expect(summary({ discontinuities: [{ kind: "recording_gap", source: "recorded_position_absence", start_d: 1, end_d: 2 }] }).discontinuities).toBeUndefined();
  });

  it("splits a neighbouring route where its recording has a gap", () => {
    const lines = reliefHistoryLines([summary({ discontinuities: [gap] })], undefined);
    expect(lines.map((line) => line.trace.map((point) => point.d))).toEqual([[0, 1_000, 2_000], [9_000, 10_000]]);
  });

  it("never invents a gap from point spacing", () => {
    const lines = reliefHistoryLines([summary()], undefined);
    expect(lines).toHaveLength(1);
    expect(lines[0].trace).toHaveLength(5);
  });

  it("leaves out the selected route, which is drawn from its detail", () => {
    expect(reliefHistoryLines([summary({ discontinuities: [gap] })], "neighbour")).toEqual([]);
  });
});

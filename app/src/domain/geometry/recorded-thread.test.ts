import { describe, expect, it } from "vitest";
import { nearestProjectedDistance, recordedPointAt, recordedThreadSegments } from "@/domain/geometry/recorded-thread";
import type { RouteDiscontinuityEvidence } from "@/domain/route";

const trace = [
  { d: 0, lng: 0, lat: 0, elev: 10 },
  { d: 100, lng: 1, lat: 0, elev: 20 },
  { d: 900, lng: 9, lat: 0, elev: 100 },
  { d: 1000, lng: 10, lat: 0, elev: 110 },
];
const gaps: RouteDiscontinuityEvidence[] = [{ startD: 100, endD: 900, kind: "recording_gap", source: "recorded_timestamps" }];

describe("recorded thread inspection", () => {
  it("interpolates recorded distance, not point index, and clamps at the finish", () => {
    expect(recordedPointAt(trace, 400)).toEqual({ d: 400, lng: 4, lat: 0, elev: 50 });
    expect(recordedPointAt(trace, 2000)).toEqual(trace[3]);
    expect(recordedPointAt(trace, NaN)).toEqual(trace[0]);
    expect(recordedPointAt([], 0)).toBeNull();
  });
  it("cannot select or draw invented geometry across a recording gap", () => {
    expect(recordedPointAt(trace, 400, gaps)).toEqual(trace[1]);
    expect(recordedPointAt(trace, 800, gaps)).toEqual(trace[2]);
    expect(recordedThreadSegments(trace, gaps)).toEqual([trace.slice(0, 2), trace.slice(2)]);
    expect(nearestProjectedDistance(trace.map(p => ({ x: p.lng, y: 0, d: p.d })), 5, 0, undefined, gaps).distanceM).not.toBe(500);
  });
  it("honours a zero-distance track boundary without inferring gaps from spacing", () => {
    expect(recordedThreadSegments(trace)).toEqual([trace]);
    expect(recordedThreadSegments(trace, [{ ...gaps[0], startD: 100, endD: 100 }])).toEqual([trace.slice(0, 2), trace.slice(2)]);
  });
  it("keeps the held branch at a projected overlap and allows a deliberate move", () => {
    const points = [{ x: 0, y: 0, d: 0 }, { x: 100, y: 0, d: 100 }, { x: 100, y: 20, d: 200 }, { x: 0, y: 0, d: 300 }];
    expect(nearestProjectedDistance(points, 0, 0, 295).distanceM).toBe(300);
    expect(nearestProjectedDistance(points, 50, 0, 295).distanceM).toBe(50);
  });
});

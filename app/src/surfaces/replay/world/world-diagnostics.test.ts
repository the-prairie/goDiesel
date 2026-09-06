import { describe, expect, it } from "vitest";
import { bindWorldDiagnostics, readWorldDiagnostics, WorldFrameHistory, type WorldDiagnostics } from "./world-diagnostics";

describe("visible frame evidence", () => {
  it("has no invented frame timing before a second drawn frame", () => {
    const history = new WorldFrameHistory();
    history.record(100, true);
    expect(history.snapshot()).toEqual({ samples: 0, medianMs: null, p95Ms: null, above50Ms: 0, windowMs: 0 });
  });
  it("includes the worst stalls but excludes time spent in a hidden tab", () => {
    const history = new WorldFrameHistory();
    history.record(100, true); history.record(116, true); history.record(1316, true);
    history.record(1400, false); history.record(10000, true); history.record(10016, true);
    expect(history.snapshot()).toEqual({ samples: 3, medianMs: 16, p95Ms: 1200, above50Ms: 1, windowMs: 1232 });
  });
  it("bounds memory and does not mutate samples when reading a report", () => {
    const history = new WorldFrameHistory(3);
    for (const value of [0, 100, 120, 150, 190]) history.record(value, true);
    expect(history.snapshot()).toEqual({ samples: 3, medianMs: 30, p95Ms: 40, above50Ms: 0, windowMs: 90 });
    expect(history.snapshot()).toEqual(history.snapshot());
    expect(() => new WorldFrameHistory(0)).toThrow();
  });
  it("does not report measurements from another or disposed renderer", () => {
    const one = new EventTarget(), two = new EventTarget();
    const report = { schema: "godiesel-world-report-v1" } as WorldDiagnostics;
    const dispose = bindWorldDiagnostics(one, () => report);
    expect(readWorldDiagnostics(one)).toEqual(report);
    expect(readWorldDiagnostics(two)).toBeNull();
    dispose(); dispose();
    expect(readWorldDiagnostics(one)).toBeNull();
  });
});

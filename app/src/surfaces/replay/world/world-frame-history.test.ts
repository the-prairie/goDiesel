import { describe, expect, it } from "vitest";
import { WorldFrameHistory } from "./world-frame-history";

describe("time-based visible frame history", () => {
  it("does not invent frame intervals before a second callback", () => {
    const history = new WorldFrameHistory(); history.record(100, true);
    expect(history.snapshot()).toMatchObject({ samples: 0, medianMs: null, p95Ms: null, windowMs: 0, fromMs: null });
  });
  for (const hz of [60, 120, 240, 360, 1000]) {
    it(`retains a full minute at ${hz} Hz, instead of the last 240 samples`, () => {
      const history = new WorldFrameHistory();
      for (let i = 0; i <= hz * 90; i++) history.record(i * 1000 / hz, true, "playing");
      const recent = history.snapshot(90_000);
      expect(recent.windowMs).toBe(60_000);
      expect(recent.samples).toBe(hz * 60);
      expect(recent.byActivity.playing.samples).toBe(hz * 60);
      expect(recent.retention.truncated).toBe(false);
      expect(history.session().samples).toBe(hz * 90);
    });
  }
  it("retains old stalls in session totals after the recent window evicts them", () => {
    const history = new WorldFrameHistory();
    history.record(0, true, "playing"); history.record(1600, true, "playing");
    for (let time = 1610; time <= 90_000; time += 10) history.record(time, true, "playing");
    expect(history.snapshot().above50Ms).toBe(0);
    expect(history.session()).toMatchObject({ above50Ms: 1, above1000Ms: 1, maxMs: 1600 });
    expect(history.session().worstIntervals).toEqual([{ endMs: 1600, durationMs: 1600, activity: "playing" }]);
  });
  it("excludes hidden gaps even if no callbacks fire while hidden", () => {
    const history = new WorldFrameHistory();
    history.record(0, true); history.record(16, true); history.suspend();
    history.record(80_000, true); history.record(80_016, true);
    expect(history.session()).toMatchObject({ samples: 2, intervalTotalMs: 32, above50Ms: 0 });
    expect(history.snapshot().samples).toBe(1);
    expect(history.snapshot(200_000).samples).toBe(0);
  });
  it("keeps very long visible intervals intact, with a clipped wall-clock window", () => {
    const history = new WorldFrameHistory(); history.record(0, true); history.record(120_000, true);
    expect(history.snapshot()).toMatchObject({ samples: 1, windowMs: 60_000, intervalTotalMs: 120_000, maxMs: 120_000 });
  });
  it("separates active playback, paused viewing and transition-spanning intervals", () => {
    const history = new WorldFrameHistory();
    history.record(0, true, "paused"); history.record(10, true, "paused");
    history.boundary(); history.record(30, true, "playing"); history.record(45, true, "playing");
    history.boundary(); history.record(65, true, "playing");
    const result = history.snapshot();
    expect(result.byActivity.paused.samples).toBe(1);
    expect(result.byActivity.playing.samples).toBe(1);
    expect(result.byActivity.transition.samples).toBe(2);
  });
  it("ignores invalid/duplicate/reversed timestamps without poisoning the next interval", () => {
    const history = new WorldFrameHistory();
    for (const time of [10, 10, NaN, 5, 20]) history.record(time, true);
    expect(history.session()).toMatchObject({ samples: 1, invalidSamples: 2, maxMs: 10 });
  });
  it("explicitly reports emergency capacity truncation and preserves session totals", () => {
    const history = new WorldFrameHistory(100, 3);
    for (const time of [0, 10, 20, 30, 40]) history.record(time, true);
    expect(history.snapshot()).toMatchObject({ samples: 3, retention: { truncated: true, capacityDrops: 1 } });
    expect(history.session().samples).toBe(4);
    expect(history.snapshot(200).retention.truncated).toBe(false);
  });
  it("exports ordered second buckets and returns detached, repeatable snapshots", () => {
    const history = new WorldFrameHistory();
    for (const time of [0, 16, 32, 1200, 1216]) history.record(time, true, "playing");
    const report = history.snapshot(); const original = history.snapshot();
    expect(report.seconds.map(row => row.fromMs)).toEqual([0, 1000]);
    report.seconds[0].samples = 999;
    expect(history.snapshot()).toEqual(original);
    expect(() => new WorldFrameHistory(0)).toThrow();
    expect(() => new WorldFrameHistory(100, 0)).toThrow();
  });
});

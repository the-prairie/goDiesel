import { describe, expect, it } from "vitest";

import { ReplayPerformanceMonitor } from "@/surfaces/replay/story-flight/replay-performance";

describe("ReplayPerformanceMonitor", () => {
  it("reports playback frame cadence and long tasks across a bounded window", () => {
    const monitor = new ReplayPerformanceMonitor({
      frameBudgetMs: 34,
      windowMs: 98,
    });

    monitor.sampleFrame(0, true);
    monitor.sampleFrame(16, true);
    monitor.sampleFrame(32, true);
    monitor.recordLongTask(62);
    monitor.sampleFrame(82, true);
    monitor.sampleFrame(98, true);

    expect(monitor.report()).toEqual({
      droppedFrameRatio: 0.25,
      durationMs: 98,
      frameCount: 4,
      longestFrameMs: 50,
      longestLongTaskMs: 62,
      longTaskCount: 1,
      p95FrameMs: 50,
      state: "complete",
    });
  });

  it("excludes paused time and stops collecting after thirty seconds", () => {
    const monitor = new ReplayPerformanceMonitor();
    monitor.sampleFrame(0, true);
    monitor.sampleFrame(16, true);
    monitor.sampleFrame(1_016, false);
    monitor.sampleFrame(5_000, true);

    for (let timestamp = 5_016; timestamp <= 35_000; timestamp += 16) {
      monitor.sampleFrame(timestamp, true);
    }
    const complete = monitor.report();
    monitor.sampleFrame(50_000, true);

    expect(complete.state).toBe("complete");
    expect(complete.durationMs).toBeGreaterThanOrEqual(30_000);
    expect(complete.longestFrameMs).toBeLessThan(20);
    expect(monitor.report()).toEqual(complete);
  });

  it("excludes a hidden-tab discontinuity before animation frames resume", () => {
    const monitor = new ReplayPerformanceMonitor();
    monitor.sampleFrame(0, true);
    monitor.sampleFrame(16, true);
    monitor.suspend();
    monitor.sampleFrame(10_000, true);
    monitor.sampleFrame(10_016, true);

    expect(monitor.report()).toMatchObject({
      durationMs: 32,
      frameCount: 2,
      longestFrameMs: 16,
      state: "sampling",
    });
  });
});

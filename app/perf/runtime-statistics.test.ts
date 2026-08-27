import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import {
  aggregateRuntimeStatistics,
  summarizeDistribution,
} from "../scripts/runtime-statistics.mjs";

describe("runtime statistical evidence", () => {
  test("marks quantiles unavailable until their sample minimum is met", () => {
    const summary = summarizeDistribution("latency", "ms", [4, 1, 3, 2]);

    expect(summary.p50).toEqual({
      value: 2,
      status: "available",
      minimumSamples: 2,
    });
    expect(summary.p95).toEqual({
      value: null,
      status: "insufficient-samples",
      minimumSamples: 20,
    });
    expect(summary.p99.status).toBe("insufficient-samples");
    expect(summary.sampleStdDev).toBeCloseTo(1.290_994_449);
    expect(summary.medianAbsoluteDeviation).toBe(1);
  });

  test("aggregates measured reports and inventories every raw artifact", () => {
    const temporaryRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "godiesel-runtime-statistics-"),
    );
    const rawDirectory = path.join(temporaryRoot, "raw");
    const outputDirectory = path.join(temporaryRoot, "evidence");
    fs.mkdirSync(rawDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(rawDirectory, "runtime-node.json"),
      JSON.stringify({
        benchmarks: [{ name: "parse", samplesMs: [1, 2, 3] }],
      }),
    );
    fs.writeFileSync(
      path.join(rawDirectory, "runtime-browser-desktop-surfaces-r000.json"),
      JSON.stringify({
        projectName: "desktop",
        phase: "measured",
        repetitionIndex: 0,
        samples: [
          {
            name: "atlas-cold",
            actionLatencyMs: 10,
            usedHeapBytes: 20,
            action: {
              reactActualDurationMs: 2,
              reactTreeBaseDurationMs: 3,
              resources: [],
            },
            observation: {
              frameIntervalsMs: [16, 17],
              longTasks: [],
              resources: [],
            },
          },
        ],
        transitionSamples: [],
      }),
    );

    const report = aggregateRuntimeStatistics({
      rawDirectory,
      outputDirectory,
      sourceCommit: "a".repeat(40),
      liveBlocker: "quota approval missing",
    });

    expect(report.distributions.map((item) => item.name)).toContain(
      "browser/desktop/atlas-cold/action-latency",
    );
    expect(report.protocol.liveProvider).toEqual({
      status: "unavailable",
      blocker: "quota approval missing",
    });
    expect(report.artifacts).toHaveLength(2);
    expect(
      report.artifacts.every((artifact) => artifact.sha256.length === 64),
    ).toBe(true);
  });
});

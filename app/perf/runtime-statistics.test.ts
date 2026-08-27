import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { describe, expect, test } from "vitest";

import {
  aggregateRuntimeStatistics,
  normalizeProfileUrl,
  summarizeDistribution,
} from "../scripts/runtime-statistics.mjs";
import {
  assertNotCancelled,
  resolveRunDirectories,
  signalProcessGroup,
  sourceStateIsClean,
  validBrowserReportIndexes,
} from "../scripts/run-runtime-statistics.mjs";
import { completeFrameInterval } from "./runtime-frame-sampling";

describe("runtime statistical evidence", () => {
  test("keeps only complete frame intervals inside the phase window", () => {
    expect(completeFrameInterval(90, 110, 100, 200)).toBeUndefined();
    expect(completeFrameInterval(110, 126, 100, 200)).toBe(16);
    expect(completeFrameInterval(190, 206, 100, 200)).toBeUndefined();
  });

  test("constrains run IDs to the runtime artifact root", () => {
    const directories = resolveRunDirectories("issue113-safe", "/tmp/app");
    expect(directories.rawDirectory).toBe(
      "/tmp/app/artifacts/runtime-statistics/raw/issue113-safe",
    );
    expect(() => resolveRunDirectories("../escape", "/tmp/app")).toThrow(
      "must be a 1-128 character slug",
    );
  });

  test("treats untracked files and prior signals as source failures", () => {
    expect(sourceStateIsClean("a", "a", "")).toBe(true);
    expect(sourceStateIsClean("a", "a", "?? untracked.json")).toBe(false);
    expect(() => assertNotCancelled("SIGTERM", "before phase")).toThrow(
      "cancelled by SIGTERM before phase",
    );
  });

  test("redacts absolute process arguments", () => {
    expect(normalizeProfileUrl("/opt/local/bin/node")).toBe("<system>/node");
  });

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
        sourceCommit: "a".repeat(40),
        status: "passed",
        benchmarks: [{ name: "parse", samplesMs: [1, 2, 3] }],
      }),
    );
    fs.writeFileSync(
      path.join(rawDirectory, "runtime-browser-desktop-surfaces-r000.json"),
      JSON.stringify({
        projectName: "desktop",
        sourceCommit: "a".repeat(40),
        status: "passed",
        phase: "measured",
        workload: "surfaces",
        repetitionIndex: 0,
        samples: [
          {
            name: "atlas-cold",
            actionLatencyMs: 10,
            usedHeapBytes: 20,
            heapBefore: { usedBytes: 10, totalBytes: 20 },
            peakObservedHeapBytes: 24,
            blockedExternalRequests: [],
            navigation: {
              name: "/",
              transferSize: 100,
              decodedBodySize: 200,
              duration: 5,
              startTime: 0,
              initiatorType: "navigation",
              origin: "local",
              phase: "navigation",
            },
            action: {
              longTasks: [],
              reactActualDurationMs: 2,
              reactTreeBaseDurationMs: 3,
              scriptDurationDeltaMs: 1,
              v8CompileDurationDeltaMs: 0.5,
              resources: [],
            },
            observation: {
              frameIntervalsMs: [16, 17],
              longTasks: [],
              scriptDurationDeltaMs: 1,
              v8CompileDurationDeltaMs: 0.5,
              resources: [],
            },
          },
        ],
        transitionSamples: [],
      }),
    );
    fs.writeFileSync(
      path.join(rawDirectory, "runtime-browser-desktop-lifecycle-r000.json"),
      JSON.stringify({
        projectName: "desktop",
        sourceCommit: "a".repeat(40),
        status: "passed",
        phase: "measured",
        workload: "lifecycle",
        repetitionIndex: 0,
        lifecycleBaselineHeapBytes: 1_000,
        samples: [],
        transitionSamples: Array.from({ length: 20 }, (_, cycle) => ({
          detailLatencyMs: 100 + cycle,
          replayLatencyMs: 50 + cycle,
          atlasReturnLatencyMs: 25 + cycle,
          usedHeapBytes: 1_010 + cycle,
        })),
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
    expect(report.distributions.map((item) => item.name)).toContain(
      "browser/desktop/atlas-cold/network-request-count",
    );
    expect(
      report.distributions.find(
        (item) =>
          item.name === "browser/desktop/atlas-cold/network-request-count",
      )?.min,
    ).toBe(1);
    const lifecycle = report.distributions.find(
      (item) => item.name === "browser/desktop/lifecycle/detail-latency",
    );
    expect(lifecycle?.p95.status).toBe("insufficient-samples");
    expect(lifecycle?.p99.status).toBe("insufficient-samples");
    expect(
      report.distributions.find(
        (item) =>
          item.name === "browser/desktop/lifecycle/final-heap-delta",
      )?.min,
    ).toBe(29);
    expect(report.protocol.liveProvider).toEqual({
      status: "unavailable",
      blocker: "quota approval missing",
    });
    expect(report.environment.hostname).toBe("redacted-local-host");
    expect(report.artifacts).toHaveLength(3);
    expect(
      report.artifacts.every((artifact) => artifact.sha256.length === 64),
    ).toBe(true);
  });

  test("rejects raw reports from a different source commit", () => {
    const temporaryRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "godiesel-runtime-source-"),
    );
    const rawDirectory = path.join(temporaryRoot, "raw");
    fs.mkdirSync(rawDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(rawDirectory, "runtime-node.json"),
      JSON.stringify({
        sourceCommit: "b".repeat(40),
        status: "passed",
        benchmarks: [{ name: "parse", samplesMs: [1, 2] }],
      }),
    );

    expect(() =>
      aggregateRuntimeStatistics({
        rawDirectory,
        outputDirectory: path.join(temporaryRoot, "evidence"),
        sourceCommit: "a".repeat(40),
      }),
    ).toThrow("do not match source commit");
  });

  test("uses live repetitions when aggregating a live-only packet", () => {
    const temporaryRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "godiesel-runtime-live-statistics-"),
    );
    const rawDirectory = path.join(temporaryRoot, "raw", "live");
    fs.mkdirSync(rawDirectory, { recursive: true });
    for (let repetitionIndex = 0; repetitionIndex < 2; repetitionIndex += 1) {
      fs.writeFileSync(
        path.join(
          rawDirectory,
          `runtime-live-provider-live-chromium-r00${repetitionIndex}.json`,
        ),
        JSON.stringify({
          sourceCommit: "a".repeat(40),
          status: "passed",
          projectName: "live-chromium",
          repetitionIndex,
          globalReadyMs: 100 + repetitionIndex,
          regionalSettlementMs: 50 + repetitionIndex,
          localApplicationReadyMs: 25 + repetitionIndex,
          globalProviderSettlementMs: 75,
        }),
      );
    }

    const report = aggregateRuntimeStatistics({
      rawDirectory: path.join(temporaryRoot, "raw"),
      outputDirectory: path.join(temporaryRoot, "evidence"),
      sourceCommit: "a".repeat(40),
    });

    expect(report.protocol.measuredRepetitions).toBe(2);
    expect(report.protocol.liveProvider).toEqual({
      status: "measured",
      repetitions: 2,
    });
  });

  test("counts only atomic passed browser reports from the exact source", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "godiesel-runtime-report-indexes-"),
    );
    const base = {
      projectName: "desktop",
      workload: "surfaces",
      phase: "measured",
      sourceCommit: "a".repeat(40),
    };
    fs.writeFileSync(
      path.join(directory, "runtime-browser-desktop-surfaces-r000.json"),
      JSON.stringify({ ...base, repetitionIndex: 0, status: "passed" }),
    );
    fs.writeFileSync(
      path.join(directory, "runtime-browser-desktop-surfaces-r001.json"),
      JSON.stringify({ ...base, repetitionIndex: 1, status: "failed" }),
    );
    fs.writeFileSync(
      path.join(directory, "runtime-browser-desktop-surfaces-r002.json"),
      JSON.stringify({
        ...base,
        repetitionIndex: 2,
        status: "passed",
        sourceCommit: "b".repeat(40),
      }),
    );
    fs.writeFileSync(
      path.join(directory, "runtime-browser-desktop-surfaces-r003.json"),
      "{not-json",
    );

    expect(
      validBrowserReportIndexes(
        directory,
        "desktop",
        "surfaces",
        "a".repeat(40),
      ),
    ).toEqual([0]);
  });

  test.runIf(process.platform !== "win32")(
    "terminates a spawned process group",
    async () => {
      const child = spawn("sh", ["-c", "sleep 30 & wait"], {
        detached: true,
        stdio: "ignore",
      });
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
      signalProcessGroup(child.pid!, "SIGTERM");
      const result = await new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
      }>((resolve) => {
        child.once("close", (code, signal) => resolve({ code, signal }));
      });
      expect(result.code).toBeNull();
      expect(result.signal).toBe("SIGTERM");
    },
  );
});

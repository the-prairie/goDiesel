import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { describe, expect, test } from "vitest";

import {
  aggregateRuntimeStatistics,
  normalizeProfileUrl,
  resolveInventoriedProfileArtifact,
  summarizeDistribution,
  validateLifecycleProtocol,
} from "../scripts/runtime-statistics.mjs";
import {
  assertNotCancelled,
  resolveRunDirectories,
  signalProcessGroup,
  sourceStateIsClean,
  validBrowserReportIndexes,
} from "../scripts/run-runtime-statistics.mjs";
import { completeFrameInterval } from "./runtime-frame-sampling";
import {
  assessLifecycleHeapStability,
  LIFECYCLE_HEAP_STABILITY_PROTOCOL,
} from "./runtime-lifecycle-stability";

describe("runtime statistical evidence", () => {
  test("accepts stable lifecycle heap noise", () => {
    const assessment = assessLifecycleHeapStability([
      100, 100.1, 99.9, 100.2, 100, 100.4, 99.8, 100.2, 100.1, 99.9, 100.3,
      100,
    ]);

    expect(assessment.stable).toBe(true);
  });

  test("rejects slow monotonic lifecycle retention", () => {
    const heaps = Array.from({ length: 40 }, (_, index) => 100 * 1.005 ** index);
    const assessment = assessLifecycleHeapStability(heaps);

    expect(assessment.stable).toBe(false);
    expect(assessment.normalizedSlopePerCycle).toBeGreaterThan(
      LIFECYCLE_HEAP_STABILITY_PROTOCOL.maximumNormalizedSlopePerCycle,
    );
  });

  test("accepts a transient JIT spike only after a stable window", () => {
    const unsettled = [100, 130, 118, 112, 110, 110.2, 109.9, 110.1];
    const settled = [
      ...unsettled,
      110,
      110.1,
      109.9,
      110,
      110.2,
      109.8,
      110.1,
      110,
    ];

    expect(assessLifecycleHeapStability(unsettled).stable).toBe(false);
    expect(assessLifecycleHeapStability(settled).stable).toBe(true);
  });

  test("keeps a steady-growth sequence unresolved at the warmup maximum", () => {
    const heaps = Array.from(
      { length: LIFECYCLE_HEAP_STABILITY_PROTOCOL.maximumCycles },
      (_, index) => 100 + index,
    );

    expect(assessLifecycleHeapStability(heaps)).toMatchObject({
      stable: false,
      sampleCount: LIFECYCLE_HEAP_STABILITY_PROTOCOL.maximumCycles,
    });
  });

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

  test("confines profile claims to unique inventoried raw artifacts", () => {
    const temporaryRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "godiesel-runtime-profile-paths-"),
    );
    const rawDirectory = path.join(temporaryRoot, "raw");
    const inventoried = path.join(rawDirectory, "profile.cpuprofile");
    const uninventoried = path.join(rawDirectory, "untracked.cpuprofile");
    const outside = path.join(temporaryRoot, "outside.cpuprofile");
    fs.mkdirSync(rawDirectory, { recursive: true });
    for (const filename of [inventoried, uninventoried, outside]) {
      fs.writeFileSync(filename, "{}");
    }
    const claimedPath = path.relative(process.cwd(), inventoried);
    const referencedFiles = new Set<string>();
    const resolve = (candidate: string) =>
      resolveInventoriedProfileArtifact({
        claimedPath: candidate,
        rawDirectory,
        inventoriedFiles: [inventoried],
        referencedFiles,
        label: "test CPU",
      });

    expect(resolve(claimedPath)).toBe(fs.realpathSync(inventoried));
    expect(() => resolve(claimedPath)).toThrow("referenced more than once");
    expect(() => resolve(path.resolve(inventoried))).toThrow("must be relative");
    expect(() =>
      resolve(path.relative(process.cwd(), outside)),
    ).toThrow("escapes the raw directory");
    expect(() =>
      resolve(path.relative(process.cwd(), uninventoried)),
    ).toThrow("not in the raw inventory");
    expect(() => resolve(`.${path.sep}${claimedPath}`)).toThrow(
      "must be canonical",
    );
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
    const lifecycleWarmupHeapBytes = [
      900, 930, 960, 990, 1_000, 1_001, 999, 1_000, 1_001, 1_000, 999,
      1_000,
    ];
    const lifecycleWarmupStability = assessLifecycleHeapStability(
      lifecycleWarmupHeapBytes,
    );
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
        lifecycleWarmupCycles: 12,
        lifecycleWarmupProtocol: {
          minimumCycles: 12,
          maximumCycles: 40,
          stabilityWindow: 8,
          maximumRangeRatio: 1.04,
          maximumNormalizedSlopePerCycle: 0.0025,
          maximumHalfDriftRatio: 1.01,
        },
        lifecycleWarmupHeapBytes,
        lifecycleWarmupStability: {
          ...lifecycleWarmupStability,
          window: 8,
          maximumRangeRatio: 1.04,
        },
        lifecycleFinalHeapRatio: 1.029,
        lifecycleFinalHeapMaximumRatio: 1.1,
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
    expect(report.protocol.lifecycleWarmup).toEqual({
      minimumCycles: 12,
      maximumCycles: 40,
      stabilityWindow: 8,
      maximumRangeRatio: 1.04,
      maximumNormalizedSlopePerCycle: 0.0025,
      maximumHalfDriftRatio: 1.01,
      observedCycles: [12],
    });
    expect(report.protocol.repetitionPlan.lifecycleWarmupCycles).toEqual([12]);
    expect(report.environment.hostname).toBe("redacted-local-host");
    expect(report.artifacts).toHaveLength(3);
    expect(
      report.artifacts.every((artifact) => artifact.sha256.length === 64),
    ).toBe(true);
  });

  test("rejects missing and mixed lifecycle convergence protocols", () => {
    const report = (cycles: number) => ({
      lifecycleWarmupCycles: cycles,
      lifecycleWarmupProtocol: {
        minimumCycles: 9,
        maximumCycles: 40,
        stabilityWindow: 8,
        maximumRangeRatio: 1.04,
        maximumNormalizedSlopePerCycle: 0.0025,
        maximumHalfDriftRatio: 1.01,
      },
      lifecycleWarmupHeapBytes: Array.from({ length: cycles }, () => 1_000),
      lifecycleBaselineHeapBytes: 1_000,
      lifecycleWarmupStability: {
        stable: true,
        sampleCount: cycles,
        windowSampleCount: 8,
        window: 8,
        maximumRangeRatio: 1.04,
        observedRangeRatio: 1,
        normalizedSlopePerCycle: 0,
        observedHalfDriftRatio: 1,
      },
    });

    expect(() => validateLifecycleProtocol([{}])).toThrow(
      "invalid warmup convergence protocol",
    );
    expect(() =>
      validateLifecycleProtocol([
        report(10),
        {
          ...report(9),
          lifecycleWarmupProtocol: {
            ...report(9).lifecycleWarmupProtocol,
            maximumCycles: 39,
          },
        },
      ]),
    ).toThrow(
      "mixed warmup convergence protocols",
    );

    const slowRetention = Array.from(
      { length: 12 },
      (_, index) => 1_000 * 1.005 ** index,
    );
    expect(() =>
      validateLifecycleProtocol([
        {
          ...report(12),
          lifecycleWarmupHeapBytes: slowRetention,
          lifecycleBaselineHeapBytes: slowRetention.at(-1),
        },
      ]),
    ).toThrow("did not reach its stability rule");
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

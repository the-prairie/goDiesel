import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type CDPSession,
  type Page,
  type TestInfo,
} from "@playwright/test";
import {
  assessLifecycleHeapStability,
  LIFECYCLE_HEAP_STABILITY_PROTOCOL,
} from "./runtime-lifecycle-stability";
import { PNG } from "pngjs";

const RUN_ID = process.env.GODIESEL_PERF_RUN_ID?.trim();
const STATISTICAL_MODE = Boolean(RUN_ID);
const WORKLOAD = process.env.GODIESEL_PERF_WORKLOAD ?? "all";
const PHASE = process.env.GODIESEL_PERF_PHASE ?? "measured";
const REPETITION_OFFSET = Number.parseInt(
  process.env.GODIESEL_PERF_REPETITION_OFFSET ?? "0",
  10,
);
const CAPTURE_PROFILES = process.env.GODIESEL_PERF_CAPTURE_PROFILES === "1";
const CAPTURE_LIFECYCLE_HEAP =
  process.env.GODIESEL_PERF_CAPTURE_LIFECYCLE_HEAP === "1";
const SOURCE_COMMIT = process.env.GODIESEL_PERF_SOURCE_COMMIT?.trim();
const OUTPUT_DIR = path.resolve(
  process.cwd(),
  STATISTICAL_MODE
    ? `artifacts/runtime-statistics/raw/${RUN_ID}/browser/${PHASE}`
    : "artifacts/runtime-performance",
);
const ROUTE_SLUG = "17654151284";
const OBSERVATION_WINDOW_MS = 750;
const LIFECYCLE_FINAL_HEAP_MAX_RATIO = 1.1;

function repetitionIndex(testInfo: TestInfo) {
  return REPETITION_OFFSET + testInfo.repeatEachIndex;
}

interface RuntimePhaseSnapshot {
  measurementStartedAtMs: number;
  measurementEndedAtMs: number;
  longTasks: Array<{ startTime: number; duration: number }>;
  frameIntervals: number[];
  reactCommits: number;
  reactActualDurationMs: number;
  reactTreeBaseDurationMs: number;
  reactCommitDurationsMs: number[];
  reactCommitProfiles: Array<{
    actualDurationMs: number;
    treeBaseDurationMs: number;
    topComponents: Array<{
      name: string;
      actualDurationMs: number;
      treeBaseDurationMs: number;
    }>;
  }>;
}

interface WebglSnapshot {
  activeContexts: number;
  connectedCanvases: number;
  retainedContextRecords: number;
  totalContextsCreated: number;
}

interface PhaseMetrics {
  measurementWindowMs: number;
  cdpWindowMs: number;
  longTasks: Array<{ startTime: number; duration: number }>;
  frameIntervalsMs: number[];
  frameP50Ms: number | null;
  frameP95Ms: number | null;
  frameP99Ms: number | null;
  estimatedFpsP95: number;
  reactCommits: number;
  reactActualDurationMs: number;
  reactTreeBaseDurationMs: number;
  reactCommitDurationsMs: number[];
  reactCommitProfiles: RuntimePhaseSnapshot["reactCommitProfiles"];
  taskDurationDeltaMs: number;
  scriptDurationDeltaMs: number;
  v8CompileDurationDeltaMs: number;
  layoutDurationDeltaMs: number;
  layoutCountDelta: number;
  recalcStyleCountDelta: number;
  resources: Array<{
    name: string;
    transferSize: number;
    decodedBodySize: number;
    duration: number;
    startTime: number;
    initiatorType: string;
    origin: "local" | "fixture" | "provider";
    phase: "action" | "observation";
  }>;
}

interface NavigationTiming {
  name: string;
  transferSize: number;
  decodedBodySize: number;
  duration: number;
  startTime: number;
  initiatorType: "navigation";
  origin: "local";
  phase: "navigation";
  domInteractive: number;
  domContentLoadedEventEnd: number;
  loadEventEnd: number;
  responseEnd: number;
}

interface BrowserSample {
  name: string;
  cacheState: "cold" | "warm";
  motionPreference: "no-preference" | "reduce";
  actionLatencyMs: number;
  observationWindowMs: number;
  sampleWallMs: number;
  usedHeapBytes: number;
  totalHeapBytes: number;
  heapBefore: { usedBytes: number; totalBytes: number };
  peakObservedHeapBytes: number;
  jsHeapUsedSize?: number;
  domNodeCount?: number;
  action: PhaseMetrics;
  observation: PhaseMetrics;
  webgl: WebglSnapshot;
  navigation?: NavigationTiming;
  profileArtifacts?: { cpu: string; allocation: string };
  blockedExternalRequests: string[];
  atlasRouteVisuals?: AtlasRouteVisual[];
}

interface AtlasRouteVisual {
  camera: "global" | "east" | "west";
  screenshot: string;
  routePixelCount: number;
  occupiedCells: number[];
}

interface TransitionSample {
  cycle: number;
  detailLatencyMs: number;
  replayLatencyMs: number;
  atlasReturnLatencyMs: number;
  usedHeapBytes: number;
  detailWebgl: WebglSnapshot;
  replayWebgl: WebglSnapshot;
  atlasWebgl: WebglSnapshot;
}

interface LifecycleHeapProfileArtifacts {
  baseline: string;
  final: string;
}

declare global {
  interface Window {
    __runtimePerf?: {
      beginPhase: (
        phase: "action" | "observation",
        durationMs?: number,
      ) => void;
      snapshot: () => {
        action: RuntimePhaseSnapshot;
        observation: RuntimePhaseSnapshot;
        webgl: WebglSnapshot;
      };
    };
    __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown;
  }
}

function percentile(values: readonly number[], quantile: number) {
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.max(0, Math.ceil(quantile * sorted.length) - 1);
  return sorted[rank] ?? 0;
}

function browserContextOptions(
  testInfo: TestInfo,
  reducedMotion: "no-preference" | "reduce" = "no-preference",
): BrowserContextOptions {
  const mobile = testInfo.project.name.includes("mobile");
  return {
    baseURL: "http://127.0.0.1:8794",
    viewport: mobile
      ? { width: 430, height: 844 }
      : { width: 1440, height: 900 },
    deviceScaleFactor: mobile ? 2 : 1,
    isMobile: mobile,
    hasTouch: mobile,
    reducedMotion,
  };
}

async function installInstrumentation(context: BrowserContext) {
  await context.addInitScript(() => {
    type Phase = "action" | "observation";
    type PhaseData = {
      measurementStartedAtMs: number;
      measurementDeadlineMs: number;
      longTasks: Array<{ startTime: number; duration: number }>;
      frameIntervals: number[];
      reactCommits: number;
      reactActualDurationMs: number;
      reactTreeBaseDurationMs: number;
      reactCommitDurationsMs: number[];
      reactCommitProfiles: RuntimePhaseSnapshot["reactCommitProfiles"];
    };
    type WebglRecord = {
      canvas: HTMLCanvasElement;
      context: WebGLRenderingContext | WebGL2RenderingContext;
      lost: boolean;
    };

    const initializedAt = performance.now();
    const phases: Record<Phase, PhaseData> = {
      action: {
        measurementStartedAtMs: initializedAt,
        measurementDeadlineMs: Number.POSITIVE_INFINITY,
        longTasks: [],
        frameIntervals: [],
        reactCommits: 0,
        reactActualDurationMs: 0,
        reactTreeBaseDurationMs: 0,
        reactCommitDurationsMs: [],
        reactCommitProfiles: [],
      },
      observation: {
        measurementStartedAtMs: initializedAt,
        measurementDeadlineMs: Number.POSITIVE_INFINITY,
        longTasks: [],
        frameIntervals: [],
        reactCommits: 0,
        reactActualDurationMs: 0,
        reactTreeBaseDurationMs: 0,
        reactCommitDurationsMs: [],
        reactCommitProfiles: [],
      },
    };
    let phase: Phase = "action";
    const webglRecords = new Map<HTMLCanvasElement, WebglRecord>();
    let totalContextsCreated = 0;
    let previousFrame = performance.now();
    let phaseStartedAt = previousFrame;
    let phaseDeadline = Number.POSITIVE_INFINITY;
    let longTaskObserver: PerformanceObserver | undefined;

    function recordLongTasks(entries: PerformanceEntryList) {
      for (const entry of entries) {
        if (
          entry.startTime < phaseStartedAt ||
          entry.startTime > phaseDeadline
        ) {
          continue;
        }
        phases[phase].longTasks.push({
          startTime: entry.startTime,
          duration: entry.duration,
        });
      }
    }

    function flushLongTasks() {
      if (longTaskObserver) recordLongTasks(longTaskObserver.takeRecords());
    }

    function completeFrameInterval(
      previousFrameMs: number,
      currentFrameMs: number,
      measurementStartedAtMs: number,
      measurementDeadlineMs: number,
    ) {
      if (
        previousFrameMs < measurementStartedAtMs ||
        currentFrameMs > measurementDeadlineMs
      ) {
        return undefined;
      }
      const interval = currentFrameMs - previousFrameMs;
      return interval > 0 && interval < 1_000 ? interval : undefined;
    }

    function resetPhase(nextPhase: Phase, durationMs?: number) {
      flushLongTasks();
      phase = nextPhase;
      phases[nextPhase].longTasks.length = 0;
      phases[nextPhase].frameIntervals.length = 0;
      phases[nextPhase].reactCommits = 0;
      phases[nextPhase].reactActualDurationMs = 0;
      phases[nextPhase].reactTreeBaseDurationMs = 0;
      phases[nextPhase].reactCommitDurationsMs.length = 0;
      phases[nextPhase].reactCommitProfiles.length = 0;
      phaseStartedAt = performance.now();
      phaseDeadline =
        durationMs === undefined
          ? Number.POSITIVE_INFINITY
          : phaseStartedAt + durationMs;
      previousFrame = phaseStartedAt;
      phases[nextPhase].measurementStartedAtMs = phaseStartedAt;
      phases[nextPhase].measurementDeadlineMs = phaseDeadline;
    }

    function webglSnapshot(): WebglSnapshot {
      let activeContexts = 0;
      let connectedCanvases = 0;
      for (const [canvas, record] of webglRecords) {
        if (!canvas.isConnected) {
          webglRecords.delete(canvas);
          continue;
        }
        connectedCanvases += 1;
        const contextLost =
          record.lost ||
          (typeof record.context.isContextLost === "function" &&
            record.context.isContextLost());
        if (!contextLost) activeContexts += 1;
      }
      return {
        activeContexts,
        connectedCanvases,
        retainedContextRecords: webglRecords.size,
        totalContextsCreated,
      };
    }

    window.__runtimePerf = {
      beginPhase(nextPhase, durationMs) {
        resetPhase(nextPhase, durationMs);
      },
      snapshot() {
        flushLongTasks();
        const capturedAt = performance.now();
        const snapshotPhase = (phaseData: PhaseData): RuntimePhaseSnapshot => ({
          measurementStartedAtMs: phaseData.measurementStartedAtMs,
          measurementEndedAtMs: Math.min(
            capturedAt,
            phaseData.measurementDeadlineMs,
          ),
          longTasks: [...phaseData.longTasks],
          frameIntervals: [...phaseData.frameIntervals],
          reactCommits: phaseData.reactCommits,
          reactActualDurationMs: phaseData.reactActualDurationMs,
          reactTreeBaseDurationMs: phaseData.reactTreeBaseDurationMs,
          reactCommitDurationsMs: [...phaseData.reactCommitDurationsMs],
          reactCommitProfiles: [...phaseData.reactCommitProfiles],
        });
        return {
          action: snapshotPhase(phases.action),
          observation: snapshotPhase(phases.observation),
          webgl: webglSnapshot(),
        };
      },
    };

    if ("PerformanceObserver" in window) {
      try {
        longTaskObserver = new PerformanceObserver((list) => {
          recordLongTasks(list.getEntries());
        });
        longTaskObserver.observe({ type: "longtask", buffered: false });
      } catch {
        // Chromium supports longtask; another engine can omit it honestly.
      }
    }

    const sampleFrame = (now: number) => {
      if (now < phaseStartedAt) {
        requestAnimationFrame(sampleFrame);
        return;
      }
      const interval = completeFrameInterval(
        previousFrame,
        now,
        phaseStartedAt,
        phaseDeadline,
      );
      if (interval !== undefined) {
        phases[phase].frameIntervals.push(interval);
      }
      previousFrame = now;
      requestAnimationFrame(sampleFrame);
    };
    requestAnimationFrame(sampleFrame);

    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      ...args: Parameters<typeof originalGetContext>
    ) {
      const context = originalGetContext.apply(this, args as never);
      const kind = args[0];
      const isWebgl =
        kind === "webgl" || kind === "webgl2" || kind === "experimental-webgl";
      if (context && isWebgl && !webglRecords.has(this)) {
        const record: WebglRecord = {
          canvas: this,
          context: context as WebGLRenderingContext | WebGL2RenderingContext,
          lost: false,
        };
        webglRecords.set(this, record);
        totalContextsCreated += 1;
        this.addEventListener("webglcontextlost", () => {
          record.lost = true;
        });
        this.addEventListener("webglcontextrestored", () => {
          record.lost = false;
        });
      }
      return context;
    } as typeof originalGetContext;

    let rendererId = 0;
    const reactRenderers = new Map<number, unknown>();
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true,
      renderers: reactRenderers,
      inject(renderer: unknown) {
        rendererId += 1;
        reactRenderers.set(rendererId, renderer);
        return rendererId;
      },
      onCommitFiberRoot(
        _rendererId: number,
        root: {
          current?: { actualDuration?: number; treeBaseDuration?: number };
        },
      ) {
        if (performance.now() <= phaseDeadline) {
          const actualDurationMs = root.current?.actualDuration ?? 0;
          const treeBaseDurationMs = root.current?.treeBaseDuration ?? 0;
          phases[phase].reactCommits += 1;
          phases[phase].reactActualDurationMs += actualDurationMs;
          phases[phase].reactTreeBaseDurationMs += treeBaseDurationMs;
          phases[phase].reactCommitDurationsMs.push(actualDurationMs);
          const components: RuntimePhaseSnapshot["reactCommitProfiles"][number]["topComponents"] =
            [];
          const visit = (
            fiber:
              | {
                  child?: unknown;
                  sibling?: unknown;
                  actualDuration?: number;
                  treeBaseDuration?: number;
                  elementType?:
                    { displayName?: string; name?: string } | string;
                  type?: { displayName?: string; name?: string } | string;
                }
              | undefined,
          ) => {
            if (!fiber) return;
            const candidate = fiber.elementType ?? fiber.type;
            const name =
              typeof candidate === "string"
                ? candidate
                : (candidate?.displayName ?? candidate?.name);
            if (name && (fiber.actualDuration ?? 0) > 0) {
              components.push({
                name,
                actualDurationMs: fiber.actualDuration ?? 0,
                treeBaseDurationMs: fiber.treeBaseDuration ?? 0,
              });
            }
            visit(fiber.child as typeof fiber);
            visit(fiber.sibling as typeof fiber);
          };
          visit(root.current);
          phases[phase].reactCommitProfiles.push({
            actualDurationMs,
            treeBaseDurationMs,
            topComponents: components
              .sort(
                (left, right) => right.actualDurationMs - left.actualDurationMs,
              )
              .slice(0, 10),
          });
        }
      },
      onCommitFiberUnmount() {},
      onPostCommitFiberRoot() {},
      checkDCE() {},
    };
  });
}

async function readPerformanceMetrics(client: CDPSession) {
  const response = await client.send("Performance.getMetrics");
  return Object.fromEntries(
    response.metrics.map((metric) => [metric.name, metric.value]),
  );
}

function metricDelta(
  after: Record<string, number>,
  before: Record<string, number>,
  name: string,
  scale = 1,
) {
  return Math.max(0, ((after[name] ?? 0) - (before[name] ?? 0)) * scale);
}

async function browserResources(
  page: Page,
  measurementStartedAtMs: number,
  measurementEndedAtMs: number,
  phase: "action" | "observation",
) {
  return page.evaluate(
    ({ startedAt, endedAt, phase }) =>
      (performance.getEntriesByType("resource") as PerformanceResourceTiming[])
        .filter(
          (resource) =>
            resource.startTime >= startedAt && resource.startTime <= endedAt,
        )
        .map((resource) => ({
          name: resource.name.replace(location.origin, ""),
          transferSize: resource.transferSize,
          decodedBodySize: resource.decodedBodySize,
          duration: resource.duration,
          startTime: resource.startTime,
          initiatorType: resource.initiatorType,
          origin: resource.name.startsWith(location.origin)
            ? ("local" as const)
            : resource.name.startsWith("https://tiles.openfreemap.org/styles/")
              ? ("fixture" as const)
              : ("provider" as const),
          phase,
        })),
    { startedAt: measurementStartedAtMs, endedAt: measurementEndedAtMs, phase },
  );
}

function phaseMetrics(
  runtime: RuntimePhaseSnapshot,
  before: Record<string, number>,
  after: Record<string, number>,
  resources: Awaited<ReturnType<typeof browserResources>>,
): PhaseMetrics {
  const hasCompleteFrames = runtime.frameIntervals.length > 0;
  const p50 = hasCompleteFrames
    ? percentile(runtime.frameIntervals, 0.5)
    : null;
  const p95 = hasCompleteFrames
    ? percentile(runtime.frameIntervals, 0.95)
    : null;
  const p99 = hasCompleteFrames
    ? percentile(runtime.frameIntervals, 0.99)
    : null;
  return {
    measurementWindowMs:
      runtime.measurementEndedAtMs - runtime.measurementStartedAtMs,
    cdpWindowMs: metricDelta(after, before, "Timestamp", 1_000),
    longTasks: runtime.longTasks,
    frameIntervalsMs: runtime.frameIntervals,
    frameP50Ms: p50,
    frameP95Ms: p95,
    frameP99Ms: p99,
    estimatedFpsP95: p95 !== null && p95 > 0 ? 1_000 / p95 : 0,
    reactCommits: runtime.reactCommits,
    reactActualDurationMs: runtime.reactActualDurationMs,
    reactTreeBaseDurationMs: runtime.reactTreeBaseDurationMs,
    reactCommitDurationsMs: runtime.reactCommitDurationsMs,
    reactCommitProfiles: runtime.reactCommitProfiles,
    taskDurationDeltaMs: metricDelta(after, before, "TaskDuration", 1_000),
    scriptDurationDeltaMs: metricDelta(after, before, "ScriptDuration", 1_000),
    v8CompileDurationDeltaMs: metricDelta(
      after,
      before,
      "V8CompileDuration",
      1_000,
    ),
    layoutDurationDeltaMs: metricDelta(after, before, "LayoutDuration", 1_000),
    layoutCountDelta: metricDelta(after, before, "LayoutCount"),
    recalcStyleCountDelta: metricDelta(after, before, "RecalcStyleCount"),
    resources,
  };
}

async function waitForAtlas(page: Page) {
  await expect(page.locator('div[data-atlas-engine="cesium"]')).toHaveAttribute(
    "data-atlas-status",
    /ready|fallback|unavailable/,
    { timeout: 60_000 },
  );
}

async function waitForAtlasCorpus(page: Page) {
  await expect(
    page.locator("[data-runtime-atlas-corpus='2500']"),
  ).toHaveAttribute("data-runtime-atlas-status", "ready", {
    timeout: 120_000,
  });
  const canvas = page.locator("canvas[data-heat-lines='2500']");
  await expect(canvas).toBeVisible({
    timeout: 120_000,
  });
  await expect
    .poll(
      () =>
        canvas.evaluate((element) => {
          const source = element as HTMLCanvasElement;
          const gl =
            source.getContext("webgl2") ??
            (source.getContext("webgl") as WebGLRenderingContext | null);
          if (!gl || source.width < 16 || source.height < 16) return 0;
          const pixels = new Uint8Array(8 * 8 * 4);
          gl.readPixels(
            Math.floor(source.width / 2) - 4,
            Math.floor(source.height / 2) - 4,
            8,
            8,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            pixels,
          );
          return pixels.reduce(
            (total, value, index) => (index % 4 === 3 ? total : total + value),
            0,
          );
        }),
      { timeout: 120_000 },
    )
    .toBeGreaterThan(0);
}

function atlasRouteVisual(buffer: Buffer, camera: AtlasRouteVisual["camera"]) {
  const image = PNG.sync.read(buffer);
  const columns = 48;
  const rows = 24;
  const occupiedCells = new Array<number>(columns * rows).fill(0);
  let routePixelCount = 0;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const index = (y * image.width + x) * 4;
      const red = image.data[index];
      const green = image.data[index + 1];
      const blue = image.data[index + 2];
      const cobaltDistanceSquared =
        (red - 98) ** 2 + (green - 167) ** 2 + (blue - 255) ** 2;
      if (cobaltDistanceSquared > 1_200) continue;
      routePixelCount += 1;
      const column = Math.min(columns - 1, Math.floor((x / image.width) * columns));
      const row = Math.min(rows - 1, Math.floor((y / image.height) * rows));
      occupiedCells[row * columns + column] += 1;
    }
  }
  return { camera, routePixelCount, occupiedCells };
}

async function captureAtlasRouteVisuals(page: Page, testInfo: TestInfo) {
  const canvas = page.locator("canvas[data-heat-lines='2500']");
  const capture = async (camera: AtlasRouteVisual["camera"]) => {
    const buffer = await canvas.screenshot();
    const screenshot = `atlas-route-${testInfo.project.name}-r${String(
      repetitionIndex(testInfo),
    ).padStart(3, "0")}-${camera}.png`;
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUTPUT_DIR, screenshot), buffer);
    const visual = { ...atlasRouteVisual(buffer, camera), screenshot };
    expect(visual.routePixelCount).toBeGreaterThan(100);
    return visual;
  };
  const visuals = [await capture("global")];
  await canvas.focus();
  for (let index = 0; index < 4; index += 1) await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(250);
  visuals.push(await capture("east"));
  for (let index = 0; index < 8; index += 1) await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(250);
  visuals.push(await capture("west"));
  return visuals;
}

function measuredSourceState() {
  const repository = path.resolve(process.cwd(), "..");
  return {
    head: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repository,
      encoding: "utf8",
    }).trim(),
    status: execFileSync(
      "git",
      ["status", "--porcelain", "--untracked-files=all"],
      { cwd: repository, encoding: "utf8" },
    ).trim(),
  };
}

function assertMeasuredSourceState() {
  const state = measuredSourceState();
  if (
    STATISTICAL_MODE &&
    (state.head !== SOURCE_COMMIT || state.status.length > 0)
  ) {
    throw new Error(
      `Runtime evidence requires exact clean source ${SOURCE_COMMIT}; observed ${state.head} with status ${JSON.stringify(state.status)}`,
    );
  }
  return state;
}

async function waitForReplay(page: Page) {
  await expect(page.getByTestId("replay-stage")).toHaveAttribute(
    "data-state",
    "ready",
    { timeout: 60_000 },
  );
}

async function captureSample(
  page: Page,
  testInfo: TestInfo,
  name: string,
  cacheState: "cold" | "warm",
  motionPreference: "no-preference" | "reduce",
  action: () => Promise<void>,
): Promise<BrowserSample> {
  const client = await page.context().newCDPSession(page);
  const blockedExternalRequests: string[] = [];
  const recordBlockedRequest = (
    request: import("@playwright/test").Request,
  ) => {
    const url = new URL(request.url());
    if (
      url.protocol.startsWith("http") &&
      url.hostname !== "127.0.0.1" &&
      url.hostname !== "localhost"
    ) {
      blockedExternalRequests.push(request.url());
    }
  };
  page.on("requestfailed", recordBlockedRequest);
  await client.send("Performance.enable");
  await client.send("HeapProfiler.enable");
  await client.send("HeapProfiler.collectGarbage");
  const heapBefore = await client.send("Runtime.getHeapUsage");
  if (CAPTURE_PROFILES) {
    await client.send("Profiler.enable");
    await client.send("Profiler.start");
    await client.send("HeapProfiler.startSampling", {
      samplingInterval: 32_768,
      includeObjectsCollectedByMajorGC: true,
      includeObjectsCollectedByMinorGC: true,
    });
  }
  const actionMetricsBefore = await readPerformanceMetrics(client);
  await page.evaluate(() => {
    performance.clearResourceTimings();
    window.__runtimePerf?.beginPhase("action");
  });

  const sampleStarted = performance.now();
  const actionStarted = performance.now();
  await action();
  const actionLatencyMs = performance.now() - actionStarted;
  const actionRuntime = await page.evaluate(
    () => window.__runtimePerf?.snapshot().action,
  );
  const actionMetricsAfter = await readPerformanceMetrics(client);
  const actionResources = await browserResources(
    page,
    actionRuntime.measurementStartedAtMs,
    actionRuntime.measurementEndedAtMs,
    "action",
  );

  const observationMetricsBefore = await readPerformanceMetrics(client);
  await page.evaluate((observationWindowMs) => {
    performance.clearResourceTimings();
    window.__runtimePerf?.beginPhase("observation", observationWindowMs);
  }, OBSERVATION_WINDOW_MS);
  await page.waitForTimeout(OBSERVATION_WINDOW_MS);
  const snapshot = await page.evaluate(() => window.__runtimePerf?.snapshot());
  const observationMetricsAfter = await readPerformanceMetrics(client);
  const observationResources = await browserResources(
    page,
    snapshot?.observation.measurementStartedAtMs ?? 0,
    snapshot?.observation.measurementEndedAtMs ?? 0,
    "observation",
  );
  await client.send("HeapProfiler.collectGarbage");
  const heap = await client.send("Runtime.getHeapUsage");
  const metricMap = observationMetricsAfter;
  const navigation = await page.evaluate(() => {
    const entry = performance.getEntriesByType("navigation")[0] as
      PerformanceNavigationTiming | undefined;
    return entry
      ? {
          name: entry.name.replace(location.origin, ""),
          startTime: entry.startTime,
          duration: entry.duration,
          domInteractive: entry.domInteractive,
          domContentLoadedEventEnd: entry.domContentLoadedEventEnd,
          loadEventEnd: entry.loadEventEnd,
          responseEnd: entry.responseEnd,
          transferSize: entry.transferSize,
          decodedBodySize: entry.decodedBodySize,
          initiatorType: "navigation" as const,
          origin: "local" as const,
          phase: "navigation" as const,
        }
      : undefined;
  });
  let profileArtifacts: BrowserSample["profileArtifacts"];
  if (CAPTURE_PROFILES) {
    const [{ profile: cpuProfile }, { profile: allocationProfile }] =
      await Promise.all([
        client.send("Profiler.stop"),
        client.send("HeapProfiler.stopSampling"),
      ]);
    const profileDir = path.join(OUTPUT_DIR, "profiles");
    fs.mkdirSync(profileDir, { recursive: true });
    const viewport = page.viewportSize();
    const stem = [
      name,
      `r${String(repetitionIndex(testInfo)).padStart(3, "0")}`,
      viewport ? `${viewport.width}x${viewport.height}` : "viewport-unknown",
    ]
      .join("-")
      .replace(/[^a-z0-9-]+/gi, "-")
      .toLowerCase();
    const cpuPath = path.join(profileDir, `${stem}.cpuprofile`);
    const allocationPath = path.join(profileDir, `${stem}.heapprofile`);
    fs.writeFileSync(cpuPath, `${JSON.stringify(cpuProfile)}\n`);
    fs.writeFileSync(allocationPath, `${JSON.stringify(allocationProfile)}\n`);
    profileArtifacts = {
      cpu: path.relative(process.cwd(), cpuPath),
      allocation: path.relative(process.cwd(), allocationPath),
    };
  }
  await client.detach();
  page.off("requestfailed", recordBlockedRequest);

  if (!actionRuntime || !snapshot) {
    throw new Error("Runtime instrumentation was not installed");
  }

  return {
    name,
    cacheState,
    motionPreference,
    actionLatencyMs,
    observationWindowMs: OBSERVATION_WINDOW_MS,
    sampleWallMs: performance.now() - sampleStarted,
    usedHeapBytes: heap.usedSize,
    totalHeapBytes: heap.totalSize,
    heapBefore: {
      usedBytes: heapBefore.usedSize,
      totalBytes: heapBefore.totalSize,
    },
    peakObservedHeapBytes: Math.max(
      heapBefore.usedSize,
      actionMetricsAfter.JSHeapUsedSize ?? 0,
      observationMetricsAfter.JSHeapUsedSize ?? 0,
      heap.usedSize,
    ),
    jsHeapUsedSize: metricMap.JSHeapUsedSize,
    domNodeCount: metricMap.Nodes,
    action: phaseMetrics(
      actionRuntime,
      actionMetricsBefore,
      actionMetricsAfter,
      actionResources,
    ),
    observation: phaseMetrics(
      snapshot.observation,
      observationMetricsBefore,
      observationMetricsAfter,
      observationResources,
    ),
    webgl: snapshot.webgl,
    navigation,
    profileArtifacts,
    blockedExternalRequests,
  };
}

async function createMeasuredPage(
  browser: Browser,
  testInfo: TestInfo,
  reducedMotion: "no-preference" | "reduce" = "no-preference",
) {
  const context = await browser.newContext(
    browserContextOptions(testInfo, reducedMotion),
  );
  if (STATISTICAL_MODE) {
    await context.route(/^https?:\/\//, async (route) => {
      const requestUrl = new URL(route.request().url());
      const hostname = requestUrl.hostname;
      if (hostname === "127.0.0.1" || hostname === "localhost") {
        await route.continue();
      } else if (
        hostname === "tiles.openfreemap.org" &&
        requestUrl.pathname.startsWith("/styles/")
      ) {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            version: 8,
            sources: {},
            layers: [
              {
                id: "hermetic-background",
                type: "background",
                paint: { "background-color": "#071114" },
              },
            ],
          }),
        });
      } else {
        await route.abort("blockedbyclient");
      }
    });
  }
  await installInstrumentation(context);
  const page = await context.newPage();
  return { context, page };
}

async function freshSample(
  browser: Browser,
  testInfo: TestInfo,
  name: string,
  action: (page: Page) => Promise<void>,
  reducedMotion: "no-preference" | "reduce" = "no-preference",
  inspect?: (page: Page) => Promise<Pick<BrowserSample, "atlasRouteVisuals">>,
) {
  const { context, page } = await createMeasuredPage(
    browser,
    testInfo,
    reducedMotion,
  );
  try {
    const sample = await captureSample(
      page,
      testInfo,
      name,
      "cold",
      reducedMotion,
      () => action(page),
    );
    return { ...sample, ...(inspect ? await inspect(page) : {}) };
  } finally {
    await context.close();
  }
}

async function writeProjectReport(
  testInfo: TestInfo,
  samples: BrowserSample[],
  transitionSamples: TransitionSample[],
  lifecycleBaselineHeapBytes?: number,
  lifecycleWarmupHeapBytes?: number[],
  lifecycleHeapProfileArtifacts?: LifecycleHeapProfileArtifacts,
  browserVersion?: string,
) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const lifecycleStability = lifecycleWarmupHeapBytes
    ? assessLifecycleHeapStability(lifecycleWarmupHeapBytes)
    : undefined;
  const lifecycleFinalHeapRatio = lifecycleBaselineHeapBytes
    ? transitionSamples.at(-1)!.usedHeapBytes / lifecycleBaselineHeapBytes
    : undefined;
  const sourceState = assertMeasuredSourceState();
  const cesiumPackage = JSON.parse(
    fs.readFileSync(path.resolve("node_modules/cesium/package.json"), "utf8"),
  ) as { version: string };
  const report = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    projectName: testInfo.project.name,
    sourceCommit: SOURCE_COMMIT,
    sourceState,
    environment: {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      cpuModel: os.cpus()[0]?.model ?? "unknown",
      cpuCount: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
      nodeVersion: process.version,
      browserVersion,
      cesiumVersion: cesiumPackage.version,
    },
    runId: RUN_ID,
    repetitionIndex: repetitionIndex(testInfo),
    workload: WORKLOAD,
    phase: PHASE,
    captureProfiles: CAPTURE_PROFILES,
    liveProvidersDisabled: true,
    status:
      lifecycleFinalHeapRatio !== undefined &&
      lifecycleFinalHeapRatio > LIFECYCLE_FINAL_HEAP_MAX_RATIO
        ? "failed"
        : "passed",
    metricSemantics: {
      actionLatencyMs:
        "Elapsed wall time from action start until the explicit readiness oracle passes; no artificial observation delay is included.",
      observationWindowMs:
        "A separate fixed window used for frame pacing, long tasks, React commits, and post-readiness CDP counter deltas.",
      resources:
        "The local document navigation is phase=navigation. Resource timing is cleared at each action or observation boundary, filtered to that in-page measurement interval, and labeled with phase and local, fixture, or provider origin.",
      frameIntervals:
        "Only complete requestAnimationFrame intervals whose two boundaries fall inside the phase window are retained. Statistical distributions use one p95 interval and derived p95 frame rate per repetition.",
      cdpWindowMs:
        "CDP counter deltas use their own Performance.Timestamp interval. This may exceed the fixed in-page observation window when main-thread work delays the protocol capture.",
      webgl:
        "activeContexts counts connected, non-lost WebGL contexts at observation end. retainedContextRecords counts instrumentation-owned strong records and must match connectedCanvases after settlement. totalContextsCreated is cumulative and is never used as the active-renderer assertion.",
    },
    samples,
    lifecycleBaselineHeapBytes,
    lifecycleWarmupCycles: lifecycleWarmupHeapBytes?.length,
    lifecycleWarmupProtocol: lifecycleWarmupHeapBytes
      ? {
          minimumCycles: LIFECYCLE_HEAP_STABILITY_PROTOCOL.minimumCycles,
          maximumCycles: LIFECYCLE_HEAP_STABILITY_PROTOCOL.maximumCycles,
          stabilityWindow: LIFECYCLE_HEAP_STABILITY_PROTOCOL.window,
          maximumRangeRatio:
            LIFECYCLE_HEAP_STABILITY_PROTOCOL.maximumRangeRatio,
          maximumNormalizedSlopePerCycle:
            LIFECYCLE_HEAP_STABILITY_PROTOCOL.maximumNormalizedSlopePerCycle,
          maximumHalfDriftRatio:
            LIFECYCLE_HEAP_STABILITY_PROTOCOL.maximumHalfDriftRatio,
        }
      : undefined,
    lifecycleWarmupHeapBytes,
    lifecycleWarmupStability: lifecycleStability
      ? {
          ...lifecycleStability,
          window: LIFECYCLE_HEAP_STABILITY_PROTOCOL.window,
          maximumRangeRatio:
            LIFECYCLE_HEAP_STABILITY_PROTOCOL.maximumRangeRatio,
        }
      : undefined,
    lifecycleFinalHeapRatio,
    lifecycleFinalHeapMaximumRatio: lifecycleWarmupHeapBytes
      ? LIFECYCLE_FINAL_HEAP_MAX_RATIO
      : undefined,
    lifecycleHeapProfileArtifacts,
    transitionSamples,
  };
  const reportPath = path.join(
    OUTPUT_DIR,
    STATISTICAL_MODE
      ? `runtime-browser-${testInfo.project.name}-${WORKLOAD}-r${String(repetitionIndex(testInfo)).padStart(3, "0")}.json`
      : `runtime-baseline-browser-${testInfo.project.name}.json`,
  );
  const temporaryPath = `${reportPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.renameSync(temporaryPath, reportPath);
}

async function captureHeapSnapshot(client: CDPSession, destination: string) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporaryPath = `${destination}.${process.pid}.tmp`;
  const descriptor = fs.openSync(temporaryPath, "wx");
  let descriptorOpen = true;
  const writeChunk = ({ chunk }: { chunk: string }) => {
    fs.writeSync(descriptor, chunk);
  };
  client.on("HeapProfiler.addHeapSnapshotChunk", writeChunk);
  try {
    await client.send("HeapProfiler.takeHeapSnapshot", {
      reportProgress: false,
      captureNumericValue: true,
    });
    fs.closeSync(descriptor);
    descriptorOpen = false;
    fs.renameSync(temporaryPath, destination);
  } catch (error) {
    if (descriptorOpen) fs.closeSync(descriptor);
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  } finally {
    client.off("HeapProfiler.addHeapSnapshotChunk", writeChunk);
  }
}

async function readWebglSnapshot(page: Page) {
  const snapshot = await page.evaluate(
    () => window.__runtimePerf?.snapshot().webgl,
  );
  if (!snapshot)
    throw new Error("WebGL lifecycle instrumentation is unavailable");
  return snapshot;
}

async function waitForRouteDetail(page: Page) {
  await expect(
    page.getByRole("region", { name: "Route briefing" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Route geography" }),
  ).toHaveAttribute("data-map-status", /ready|unavailable/);
}

async function measureTransitions(
  browser: Browser,
  testInfo: TestInfo,
): Promise<{
  baselineUsedHeapBytes: number;
  warmupUsedHeapBytes: number[];
  samples: TransitionSample[];
  heapProfileArtifacts?: LifecycleHeapProfileArtifacts;
}> {
  const { context, page } = await createMeasuredPage(browser, testInfo);
  try {
    await page.goto("/#/atlas", { waitUntil: "domcontentloaded" });
    await waitForAtlas(page);
    const client = await context.newCDPSession(page);
    await client.send("HeapProfiler.enable");
    const navigateHash = async (hash: string) => {
      await page.evaluate((nextHash) => {
        window.location.hash = nextHash;
      }, hash);
      await expect(page).toHaveURL(
        new RegExp(hash.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );
    };

    const warmupUsedHeapBytes: number[] = [];
    for (
      let cycle = 0;
      cycle < LIFECYCLE_HEAP_STABILITY_PROTOCOL.maximumCycles;
      cycle += 1
    ) {
      await navigateHash(`#/routes/${ROUTE_SLUG}`);
      await waitForRouteDetail(page);
      await readWebglSnapshot(page);
      await navigateHash(`#/replay/${ROUTE_SLUG}?renderer=atlas`);
      await waitForReplay(page);
      await readWebglSnapshot(page);
      await navigateHash("#/atlas");
      await waitForAtlas(page);
      await readWebglSnapshot(page);
      await client.send("HeapProfiler.collectGarbage");
      const warmupHeap = await client.send("Runtime.getHeapUsage");
      warmupUsedHeapBytes.push(warmupHeap.usedSize);
      if (assessLifecycleHeapStability(warmupUsedHeapBytes).stable) {
        break;
      }
    }
    const baselineUsedHeapBytes = warmupUsedHeapBytes.at(-1)!;
    const profileDirectory = path.join(OUTPUT_DIR, "profiles");
    const profileStem = `lifecycle-${testInfo.project.name}-r${String(repetitionIndex(testInfo)).padStart(3, "0")}`;
    const baselineProfilePath = path.join(
      profileDirectory,
      `${profileStem}-baseline.heapsnapshot`,
    );
    const finalProfilePath = path.join(
      profileDirectory,
      `${profileStem}-final.heapsnapshot`,
    );
    if (CAPTURE_LIFECYCLE_HEAP) {
      await captureHeapSnapshot(client, baselineProfilePath);
    }
    const samples: TransitionSample[] = [];
    for (let cycle = 1; cycle <= 20; cycle += 1) {
      const detailStarted = performance.now();
      await navigateHash(`#/routes/${ROUTE_SLUG}`);
      await waitForRouteDetail(page);
      const detailLatencyMs = performance.now() - detailStarted;
      const detailWebgl = await readWebglSnapshot(page);

      const replayStarted = performance.now();
      await navigateHash(`#/replay/${ROUTE_SLUG}?renderer=atlas`);
      await waitForReplay(page);
      const replayLatencyMs = performance.now() - replayStarted;
      const replayWebgl = await readWebglSnapshot(page);

      const atlasStarted = performance.now();
      await navigateHash("#/atlas");
      await waitForAtlas(page);
      const atlasReturnLatencyMs = performance.now() - atlasStarted;
      const atlasWebgl = await readWebglSnapshot(page);

      await client.send("HeapProfiler.collectGarbage");
      const heap = await client.send("Runtime.getHeapUsage");
      samples.push({
        cycle,
        detailLatencyMs,
        replayLatencyMs,
        atlasReturnLatencyMs,
        usedHeapBytes: heap.usedSize,
        detailWebgl,
        replayWebgl,
        atlasWebgl,
      });
    }
    if (CAPTURE_LIFECYCLE_HEAP) {
      await client.send("HeapProfiler.collectGarbage");
      await captureHeapSnapshot(client, finalProfilePath);
    }
    await client.detach();
    return {
      baselineUsedHeapBytes,
      warmupUsedHeapBytes,
      samples,
      heapProfileArtifacts: CAPTURE_LIFECYCLE_HEAP
        ? {
            baseline: path.relative(process.cwd(), baselineProfilePath),
            final: path.relative(process.cwd(), finalProfilePath),
          }
        : undefined,
    };
  } finally {
    await context.close();
  }
}

test("records isolated surface, reduced-motion, scale, and lifecycle baselines", async ({
  browser,
}, testInfo) => {
  if (STATISTICAL_MODE && !SOURCE_COMMIT) {
    throw new Error(
      "GODIESEL_PERF_SOURCE_COMMIT is required in statistical mode",
    );
  }
  assertMeasuredSourceState();
  const samples: BrowserSample[] = [];
  const surfaceGroups: Array<() => Promise<BrowserSample[]>> = [
    async () => {
      const atlasContext = await createMeasuredPage(browser, testInfo);
      try {
        return [
          await captureSample(
            atlasContext.page,
            testInfo,
            "atlas-cold",
            "cold",
            "no-preference",
            async () => {
              await atlasContext.page.goto("/#/atlas", {
                waitUntil: "domcontentloaded",
              });
              await waitForAtlas(atlasContext.page);
            },
          ),
          await captureSample(
            atlasContext.page,
            testInfo,
            "atlas-warm-reload",
            "warm",
            "no-preference",
            async () => {
              await atlasContext.page.reload({ waitUntil: "domcontentloaded" });
              await waitForAtlas(atlasContext.page);
            },
          ),
        ];
      } finally {
        await atlasContext.context.close();
      }
    },
    async () => [
      await freshSample(browser, testInfo, "routes-cold", async (page) => {
        await page.goto("/#/routes", { waitUntil: "domcontentloaded" });
        await expect(
          page.getByRole("heading", {
            level: 1,
            name: "Your route library.",
            exact: true,
          }),
        ).toBeVisible();
      }),
    ],
    async () => [
      await freshSample(browser, testInfo, "finder-cold", async (page) => {
        await page.goto("/#/finder", { waitUntil: "domcontentloaded" });
        await expect(
          page.getByRole("heading", {
            level: 1,
            name: "Plan the next day.",
            exact: true,
          }),
        ).toBeVisible();
      }),
    ],
    async () => [
      await freshSample(
        browser,
        testInfo,
        "route-detail-cold",
        async (page) => {
          await page.goto(`/#/routes/${ROUTE_SLUG}`, {
            waitUntil: "domcontentloaded",
          });
          await waitForRouteDetail(page);
        },
      ),
    ],
    async () => [
      await freshSample(
        browser,
        testInfo,
        "replay-atlas-cold",
        async (page) => {
          await page.goto(`/#/replay/${ROUTE_SLUG}?renderer=atlas`, {
            waitUntil: "domcontentloaded",
          });
          await waitForReplay(page);
        },
      ),
    ],
    async () => [
      await freshSample(
        browser,
        testInfo,
        "atlas-reduced-motion-cold",
        async (page) => {
          await page.goto("/#/atlas", { waitUntil: "domcontentloaded" });
          await waitForAtlas(page);
        },
        "reduce",
      ),
    ],
    async () => [
      await freshSample(
        browser,
        testInfo,
        "replay-atlas-reduced-motion-cold",
        async (page) => {
          await page.goto(`/#/replay/${ROUTE_SLUG}?renderer=atlas`, {
            waitUntil: "domcontentloaded",
          });
          await waitForReplay(page);
        },
        "reduce",
      ),
    ],
    async () => [
      await freshSample(
        browser,
        testInfo,
        "atlas-2,500-source-backed-routes",
        async (page) => {
          await page.goto("/perf/atlas-corpus-harness.html", {
            waitUntil: "domcontentloaded",
          });
          await waitForAtlasCorpus(page);
        },
        "no-preference",
        repetitionIndex(testInfo) === 0
          ? async (page) => ({
              atlasRouteVisuals: await captureAtlasRouteVisuals(page, testInfo),
            })
          : undefined,
      ),
    ],
  ];

  const measuredSurfaceGroups =
    WORKLOAD === "atlas-scale" ? [surfaceGroups.at(-1)!] : surfaceGroups;
  if (WORKLOAD !== "lifecycle") {
    const offset = repetitionIndex(testInfo) % measuredSurfaceGroups.length;
    const orderedGroups = [
      ...measuredSurfaceGroups.slice(offset),
      ...measuredSurfaceGroups.slice(0, offset),
    ];
    for (const group of orderedGroups) samples.push(...(await group()));
  }

  const lifecycleMeasurement =
    (WORKLOAD !== "all" && WORKLOAD !== "lifecycle") || CAPTURE_PROFILES
      ? undefined
      : await measureTransitions(browser, testInfo);
  const transitionSamples = lifecycleMeasurement?.samples ?? [];

  expect(samples).toHaveLength(
    WORKLOAD === "lifecycle" ? 0 : WORKLOAD === "atlas-scale" ? 1 : 9,
  );
  expect(transitionSamples).toHaveLength(
    (WORKLOAD !== "all" && WORKLOAD !== "lifecycle") || CAPTURE_PROFILES
      ? 0
      : 20,
  );
  expect(
    samples.every((sample) => sample.sampleWallMs >= sample.actionLatencyMs),
  ).toBe(true);
  expect(
    samples.every(
      (sample) =>
        sample.observationWindowMs === OBSERVATION_WINDOW_MS &&
        sample.sampleWallMs >=
          sample.actionLatencyMs + sample.observationWindowMs,
    ),
  ).toBe(true);
  expect(
    samples.every((sample) => {
      const observedFrameTime = sample.observation.frameIntervalsMs.reduce(
        (total, interval) => total + interval,
        0,
      );
      return (
        (sample.observation.frameIntervalsMs.length > 0 ||
          sample.observation.estimatedFpsP95 === 0) &&
        sample.observation.measurementWindowMs <=
          sample.observationWindowMs + 1 &&
        observedFrameTime <= sample.observationWindowMs + 1
      );
    }),
  ).toBe(true);
  expect(
    transitionSamples.every(
      (sample) =>
        sample.detailWebgl.activeContexts === 1 &&
        sample.detailWebgl.retainedContextRecords === 1 &&
        sample.replayWebgl.activeContexts === 1 &&
        sample.replayWebgl.retainedContextRecords === 1 &&
        sample.atlasWebgl.activeContexts === 1 &&
        sample.atlasWebgl.retainedContextRecords === 1,
    ),
  ).toBe(true);
  if (lifecycleMeasurement) {
    expect(
      assessLifecycleHeapStability(
        lifecycleMeasurement.warmupUsedHeapBytes,
      ).stable,
    ).toBe(true);
    expect(lifecycleMeasurement.baselineUsedHeapBytes).toBeGreaterThan(0);
    expect(
      transitionSamples.at(-1)!.usedHeapBytes /
        lifecycleMeasurement.baselineUsedHeapBytes,
    ).toBeLessThanOrEqual(LIFECYCLE_FINAL_HEAP_MAX_RATIO);
  }
  await writeProjectReport(
    testInfo,
    samples,
    transitionSamples,
    lifecycleMeasurement?.baselineUsedHeapBytes,
    lifecycleMeasurement?.warmupUsedHeapBytes,
    lifecycleMeasurement?.heapProfileArtifacts,
    browser.version(),
  );
});

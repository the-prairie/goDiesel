import fs from "node:fs";
import path from "node:path";

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

const OUTPUT_DIR = path.resolve(process.cwd(), "artifacts/runtime-performance");
const ROUTE_SLUG = "17654151284";
const OBSERVATION_WINDOW_MS = 750;

interface RuntimePhaseSnapshot {
  longTasks: Array<{ startTime: number; duration: number }>;
  frameIntervals: number[];
  reactCommits: number;
}

interface WebglSnapshot {
  activeContexts: number;
  connectedCanvases: number;
  totalContextsCreated: number;
}

interface PhaseMetrics {
  longTasks: Array<{ startTime: number; duration: number }>;
  frameIntervalsMs: number[];
  frameP50Ms: number;
  frameP95Ms: number;
  frameP99Ms: number;
  estimatedFpsP95: number;
  reactCommits: number;
  taskDurationDeltaMs: number;
  scriptDurationDeltaMs: number;
  layoutDurationDeltaMs: number;
  layoutCountDelta: number;
  recalcStyleCountDelta: number;
  resources: Array<{
    name: string;
    transferSize: number;
    decodedBodySize: number;
    duration: number;
  }>;
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
  jsHeapUsedSize?: number;
  domNodeCount?: number;
  action: PhaseMetrics;
  observation: PhaseMetrics;
  webgl: WebglSnapshot;
  navigation?: Record<string, number>;
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

declare global {
  interface Window {
    __runtimePerf?: {
      beginPhase: (phase: "action" | "observation") => void;
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
    viewport: mobile ? { width: 430, height: 844 } : { width: 1440, height: 900 },
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
      longTasks: Array<{ startTime: number; duration: number }>;
      frameIntervals: number[];
      reactCommits: number;
    };
    type WebglRecord = {
      canvas: HTMLCanvasElement;
      context: WebGLRenderingContext | WebGL2RenderingContext;
      lost: boolean;
    };

    const phases: Record<Phase, PhaseData> = {
      action: { longTasks: [], frameIntervals: [], reactCommits: 0 },
      observation: { longTasks: [], frameIntervals: [], reactCommits: 0 },
    };
    let phase: Phase = "action";
    const webglRecords = new Map<HTMLCanvasElement, WebglRecord>();
    let totalContextsCreated = 0;

    function resetPhase(nextPhase: Phase) {
      phase = nextPhase;
      phases[nextPhase].longTasks.length = 0;
      phases[nextPhase].frameIntervals.length = 0;
      phases[nextPhase].reactCommits = 0;
    }

    function webglSnapshot(): WebglSnapshot {
      let activeContexts = 0;
      let connectedCanvases = 0;
      for (const record of webglRecords.values()) {
        if (!record.canvas.isConnected) continue;
        connectedCanvases += 1;
        const contextLost =
          record.lost ||
          (typeof record.context.isContextLost === "function" &&
            record.context.isContextLost());
        if (!contextLost) activeContexts += 1;
      }
      return { activeContexts, connectedCanvases, totalContextsCreated };
    }

    window.__runtimePerf = {
      beginPhase(nextPhase) {
        resetPhase(nextPhase);
      },
      snapshot() {
        return {
          action: {
            longTasks: [...phases.action.longTasks],
            frameIntervals: [...phases.action.frameIntervals],
            reactCommits: phases.action.reactCommits,
          },
          observation: {
            longTasks: [...phases.observation.longTasks],
            frameIntervals: [...phases.observation.frameIntervals],
            reactCommits: phases.observation.reactCommits,
          },
          webgl: webglSnapshot(),
        };
      },
    };

    if ("PerformanceObserver" in window) {
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            phases[phase].longTasks.push({
              startTime: entry.startTime,
              duration: entry.duration,
            });
          }
        });
        observer.observe({ type: "longtask", buffered: false });
      } catch {
        // Chromium supports longtask; another engine can omit it honestly.
      }
    }

    let previousFrame = performance.now();
    const sampleFrame = (now: number) => {
      const interval = now - previousFrame;
      if (interval > 0 && interval < 1_000) {
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
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true,
      renderers: new Map(),
      inject() {
        rendererId += 1;
        return rendererId;
      },
      onCommitFiberRoot() {
        phases[phase].reactCommits += 1;
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

async function browserResources(page: Page) {
  return page.evaluate(() =>
    (performance.getEntriesByType("resource") as PerformanceResourceTiming[]).map(
      (resource) => ({
        name: resource.name.replace(location.origin, ""),
        transferSize: resource.transferSize,
        decodedBodySize: resource.decodedBodySize,
        duration: resource.duration,
      }),
    ),
  );
}

function phaseMetrics(
  runtime: RuntimePhaseSnapshot,
  before: Record<string, number>,
  after: Record<string, number>,
  resources: Awaited<ReturnType<typeof browserResources>>,
): PhaseMetrics {
  const p50 = percentile(runtime.frameIntervals, 0.5);
  const p95 = percentile(runtime.frameIntervals, 0.95);
  const p99 = percentile(runtime.frameIntervals, 0.99);
  return {
    longTasks: runtime.longTasks,
    frameIntervalsMs: runtime.frameIntervals,
    frameP50Ms: p50,
    frameP95Ms: p95,
    frameP99Ms: p99,
    estimatedFpsP95: p95 > 0 ? 1_000 / p95 : 0,
    reactCommits: runtime.reactCommits,
    taskDurationDeltaMs: metricDelta(after, before, "TaskDuration", 1_000),
    scriptDurationDeltaMs: metricDelta(after, before, "ScriptDuration", 1_000),
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
  await expect(page.locator("[data-runtime-atlas-corpus='2500']")).toHaveAttribute(
    "data-runtime-atlas-status",
    /ready|unavailable/,
    { timeout: 120_000 },
  );
  await expect(page.locator("canvas[data-heat-lines='2500']")).toBeVisible({
    timeout: 120_000,
  });
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
  name: string,
  cacheState: "cold" | "warm",
  motionPreference: "no-preference" | "reduce",
  action: () => Promise<void>,
): Promise<BrowserSample> {
  const client = await page.context().newCDPSession(page);
  await client.send("Performance.enable");
  const actionMetricsBefore = await readPerformanceMetrics(client);
  await page.evaluate(() => {
    performance.clearResourceTimings();
    window.__runtimePerf?.beginPhase("action");
  });

  const sampleStarted = performance.now();
  const actionStarted = performance.now();
  await action();
  const actionLatencyMs = performance.now() - actionStarted;
  const actionMetricsAfter = await readPerformanceMetrics(client);
  const actionResources = await browserResources(page);
  const actionRuntime = await page.evaluate(
    () => window.__runtimePerf?.snapshot().action,
  );

  await page.evaluate(() => {
    performance.clearResourceTimings();
    window.__runtimePerf?.beginPhase("observation");
  });
  const observationMetricsBefore = await readPerformanceMetrics(client);
  await page.waitForTimeout(OBSERVATION_WINDOW_MS);
  const observationMetricsAfter = await readPerformanceMetrics(client);
  const observationResources = await browserResources(page);
  const snapshot = await page.evaluate(() => window.__runtimePerf?.snapshot());
  const heap = await client.send("Runtime.getHeapUsage");
  const metricMap = observationMetricsAfter;
  const navigation = await page.evaluate(() => {
    const entry = performance.getEntriesByType(
      "navigation",
    )[0] as PerformanceNavigationTiming | undefined;
    return entry
      ? {
          duration: entry.duration,
          domInteractive: entry.domInteractive,
          domContentLoadedEventEnd: entry.domContentLoadedEventEnd,
          loadEventEnd: entry.loadEventEnd,
          responseEnd: entry.responseEnd,
          transferSize: entry.transferSize,
          decodedBodySize: entry.decodedBodySize,
        }
      : undefined;
  });
  await client.detach();

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
) {
  const { context, page } = await createMeasuredPage(
    browser,
    testInfo,
    reducedMotion,
  );
  try {
    return await captureSample(
      page,
      name,
      "cold",
      reducedMotion,
      () => action(page),
    );
  } finally {
    await context.close();
  }
}

async function writeProjectReport(
  projectName: string,
  samples: BrowserSample[],
  transitionSamples: TransitionSample[],
) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const report = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    projectName,
    liveProvidersDisabled: true,
    metricSemantics: {
      actionLatencyMs:
        "Elapsed wall time from action start until the explicit readiness oracle passes; no artificial observation delay is included.",
      observationWindowMs:
        "A separate fixed window used for frame pacing, long tasks, React commits, and post-readiness CDP counter deltas.",
      resources:
        "Resource timing is cleared at each phase boundary; each list contains only entries created during that phase in a fresh document.",
      webgl:
        "activeContexts counts connected, non-lost WebGL contexts at observation end. totalContextsCreated is cumulative and is never used as the active-renderer assertion.",
    },
    samples,
    transitionSamples,
  };
  fs.writeFileSync(
    path.join(OUTPUT_DIR, `runtime-baseline-browser-${projectName}.json`),
    `${JSON.stringify(report, null, 2)}\n`,
  );
}

async function readWebglSnapshot(page: Page) {
  const snapshot = await page.evaluate(
    () => window.__runtimePerf?.snapshot().webgl,
  );
  if (!snapshot) throw new Error("WebGL lifecycle instrumentation is unavailable");
  return snapshot;
}

async function measureTransitions(
  browser: Browser,
  testInfo: TestInfo,
): Promise<TransitionSample[]> {
  const { context, page } = await createMeasuredPage(browser, testInfo);
  try {
    await page.goto("/#/atlas", { waitUntil: "domcontentloaded" });
    await waitForAtlas(page);
    const navigateHash = async (hash: string) => {
      await page.evaluate((nextHash) => {
        window.location.hash = nextHash;
      }, hash);
      await expect(page).toHaveURL(
        new RegExp(hash.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );
    };

    const samples: TransitionSample[] = [];
    for (let cycle = 1; cycle <= 20; cycle += 1) {
      const detailStarted = performance.now();
      await navigateHash(`#/routes/${ROUTE_SLUG}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
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

      const client = await context.newCDPSession(page);
      await client.send("HeapProfiler.collectGarbage");
      const heap = await client.send("Runtime.getHeapUsage");
      await client.detach();
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
    return samples;
  } finally {
    await context.close();
  }
}

test("records isolated surface, reduced-motion, scale, and lifecycle baselines", async ({
  browser,
}, testInfo) => {
  const samples: BrowserSample[] = [];

  const atlasContext = await createMeasuredPage(browser, testInfo);
  try {
    samples.push(
      await captureSample(
        atlasContext.page,
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
    );
    samples.push(
      await captureSample(
        atlasContext.page,
        "atlas-warm-reload",
        "warm",
        "no-preference",
        async () => {
          await atlasContext.page.reload({ waitUntil: "domcontentloaded" });
          await waitForAtlas(atlasContext.page);
        },
      ),
    );
  } finally {
    await atlasContext.context.close();
  }

  samples.push(
    await freshSample(browser, testInfo, "routes-cold", async (page) => {
      await page.goto("/#/routes", { waitUntil: "domcontentloaded" });
      await expect(
        page.getByRole("heading", { level: 1, name: "Your route library." }),
      ).toBeVisible();
    }),
  );
  samples.push(
    await freshSample(browser, testInfo, "finder-cold", async (page) => {
      await page.goto("/#/finder", { waitUntil: "domcontentloaded" });
      await expect(
        page.getByRole("heading", { level: 1, name: "Plan the next day." }),
      ).toBeVisible();
    }),
  );
  samples.push(
    await freshSample(browser, testInfo, "route-detail-cold", async (page) => {
      await page.goto(`/#/routes/${ROUTE_SLUG}`, {
        waitUntil: "domcontentloaded",
      });
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    }),
  );
  samples.push(
    await freshSample(browser, testInfo, "replay-atlas-cold", async (page) => {
      await page.goto(`/#/replay/${ROUTE_SLUG}?renderer=atlas`, {
        waitUntil: "domcontentloaded",
      });
      await waitForReplay(page);
    }),
  );
  samples.push(
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
  );
  samples.push(
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
  );
  samples.push(
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
    ),
  );

  const transitionSamples = await measureTransitions(browser, testInfo);
  await writeProjectReport(testInfo.project.name, samples, transitionSamples);

  expect(samples).toHaveLength(9);
  expect(transitionSamples).toHaveLength(20);
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
    transitionSamples.every(
      (sample) =>
        sample.detailWebgl.activeContexts === 0 &&
        sample.replayWebgl.activeContexts <= 1 &&
        sample.atlasWebgl.activeContexts <= 1,
    ),
  ).toBe(true);
});

import fs from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

const OUTPUT_DIR = path.resolve(process.cwd(), "artifacts/runtime-performance");
const ROUTE_SLUG = "17654151284";

interface BrowserSample {
  name: string;
  durationMs: number;
  usedHeapBytes: number;
  totalHeapBytes: number;
  jsHeapUsedSize?: number;
  domNodeCount?: number;
  layoutCount?: number;
  recalcStyleCount?: number;
  taskDurationMs?: number;
  scriptDurationMs?: number;
  layoutDurationMs?: number;
  longTasks: Array<{ startTime: number; duration: number }>;
  frameIntervalsMs: number[];
  frameP50Ms: number;
  frameP95Ms: number;
  frameP99Ms: number;
  estimatedFpsP95: number;
  webglContextsCreated: number;
  reactCommits: number;
  resources: Array<{ name: string; transferSize: number; decodedBodySize: number; duration: number }>;
  navigation?: Record<string, number>;
}

declare global {
  interface Window {
    __runtimePerf?: {
      longTasks: Array<{ startTime: number; duration: number }>;
      frameIntervals: number[];
      webglContexts: Set<unknown>;
      reactCommits: number;
      reset: () => void;
    };
    __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown;
  }
}

function percentile(values: readonly number[], quantile: number) {
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.max(0, Math.ceil(quantile * sorted.length) - 1);
  return sorted[rank] ?? 0;
}

async function installInstrumentation(page: Page) {
  await page.addInitScript(() => {
    const state = {
      longTasks: [] as Array<{ startTime: number; duration: number }>,
      frameIntervals: [] as number[],
      webglContexts: new Set<unknown>(),
      reactCommits: 0,
      reset() {
        this.longTasks.length = 0;
        this.frameIntervals.length = 0;
        this.reactCommits = 0;
      },
    };
    window.__runtimePerf = state;

    if ("PerformanceObserver" in window) {
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            state.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
          }
        });
        observer.observe({ type: "longtask", buffered: true });
      } catch {
        // Chromium supports longtask; other engines may not.
      }
    }

    let previousFrame = performance.now();
    const sampleFrame = (now: number) => {
      const interval = now - previousFrame;
      if (interval > 0 && interval < 1_000) state.frameIntervals.push(interval);
      previousFrame = now;
      requestAnimationFrame(sampleFrame);
    };
    requestAnimationFrame(sampleFrame);

    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (...args: Parameters<typeof originalGetContext>) {
      const context = originalGetContext.apply(this, args as never);
      const kind = args[0];
      if (context && (kind === "webgl" || kind === "webgl2" || kind === "experimental-webgl")) {
        state.webglContexts.add(context);
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
        state.reactCommits += 1;
      },
      onCommitFiberUnmount() {},
      onPostCommitFiberRoot() {},
      checkDCE() {},
    };
  });
}

async function waitForAtlas(page: Page) {
  await expect(page.locator('[data-atlas-engine="cesium"]')).toHaveAttribute(
    "data-atlas-status",
    /ready|fallback/,
    { timeout: 30_000 },
  );
}

async function waitForReplay(page: Page) {
  await expect(page.getByTestId("replay-stage")).toHaveAttribute("data-state", "ready", {
    timeout: 30_000,
  });
}

async function captureSample(
  page: Page,
  name: string,
  action: () => Promise<void>,
): Promise<BrowserSample> {
  await page.evaluate(() => window.__runtimePerf?.reset());
  const client = await page.context().newCDPSession(page);
  await client.send("Performance.enable");
  const started = performance.now();
  await action();
  await page.waitForTimeout(750);
  const durationMs = performance.now() - started;
  const heap = await client.send("Runtime.getHeapUsage");
  const performanceMetrics = await client.send("Performance.getMetrics");
  const metricMap = Object.fromEntries(
    performanceMetrics.metrics.map((metric) => [metric.name, metric.value]),
  );
  const runtime = await page.evaluate(() => {
    const perf = window.__runtimePerf;
    const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    return {
      longTasks: perf?.longTasks ?? [],
      frameIntervals: perf?.frameIntervals ?? [],
      webglContextsCreated: perf?.webglContexts.size ?? 0,
      reactCommits: perf?.reactCommits ?? 0,
      resources: resources.map((resource) => ({
        name: resource.name.replace(location.origin, ""),
        transferSize: resource.transferSize,
        decodedBodySize: resource.decodedBodySize,
        duration: resource.duration,
      })),
      navigation: navigation
        ? {
            duration: navigation.duration,
            domInteractive: navigation.domInteractive,
            domContentLoadedEventEnd: navigation.domContentLoadedEventEnd,
            loadEventEnd: navigation.loadEventEnd,
            responseEnd: navigation.responseEnd,
            transferSize: navigation.transferSize,
            decodedBodySize: navigation.decodedBodySize,
          }
        : undefined,
    };
  });
  const p50 = percentile(runtime.frameIntervals, 0.5);
  const p95 = percentile(runtime.frameIntervals, 0.95);
  const p99 = percentile(runtime.frameIntervals, 0.99);
  await client.detach();
  return {
    name,
    durationMs,
    usedHeapBytes: heap.usedSize,
    totalHeapBytes: heap.totalSize,
    jsHeapUsedSize: metricMap.JSHeapUsedSize,
    domNodeCount: metricMap.Nodes,
    layoutCount: metricMap.LayoutCount,
    recalcStyleCount: metricMap.RecalcStyleCount,
    taskDurationMs: metricMap.TaskDuration ? metricMap.TaskDuration * 1_000 : undefined,
    scriptDurationMs: metricMap.ScriptDuration ? metricMap.ScriptDuration * 1_000 : undefined,
    layoutDurationMs: metricMap.LayoutDuration ? metricMap.LayoutDuration * 1_000 : undefined,
    longTasks: runtime.longTasks,
    frameIntervalsMs: runtime.frameIntervals,
    frameP50Ms: p50,
    frameP95Ms: p95,
    frameP99Ms: p99,
    estimatedFpsP95: p95 > 0 ? 1_000 / p95 : 0,
    webglContextsCreated: runtime.webglContextsCreated,
    reactCommits: runtime.reactCommits,
    resources: runtime.resources,
    navigation: runtime.navigation,
  };
}

async function writeProjectReport(projectName: string, samples: BrowserSample[], extra: object = {}) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    projectName,
    liveProvidersDisabled: true,
    samples,
    ...extra,
  };
  fs.writeFileSync(
    path.join(OUTPUT_DIR, `runtime-baseline-browser-${projectName}.json`),
    `${JSON.stringify(report, null, 2)}\n`,
  );
}

test("records cold/warm surface and transition baselines", async ({ page }, testInfo) => {
  await installInstrumentation(page);
  const samples: BrowserSample[] = [];

  samples.push(
    await captureSample(page, "atlas-cold", async () => {
      await page.goto("/#/atlas", { waitUntil: "domcontentloaded" });
      await waitForAtlas(page);
    }),
  );
  samples.push(
    await captureSample(page, "atlas-warm-reload", async () => {
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitForAtlas(page);
    }),
  );
  samples.push(
    await captureSample(page, "routes", async () => {
      await page.goto("/#/routes", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: /routes/i })).toBeVisible();
    }),
  );
  samples.push(
    await captureSample(page, "finder", async () => {
      await page.goto("/#/finder", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: /plan/i })).toBeVisible();
    }),
  );
  samples.push(
    await captureSample(page, "route-detail", async () => {
      await page.goto(`/#/routes/${ROUTE_SLUG}`, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    }),
  );
  samples.push(
    await captureSample(page, "replay-atlas", async () => {
      await page.goto(`/#/replay/${ROUTE_SLUG}?renderer=atlas`, {
        waitUntil: "domcontentloaded",
      });
      await waitForReplay(page);
    }),
  );

  const transitionHeap: Array<{ cycle: number; usedHeapBytes: number; webglContextsCreated: number }> = [];
  await page.goto("/#/atlas", { waitUntil: "domcontentloaded" });
  await waitForAtlas(page);
  const navigateHash = async (hash: string) => {
    await page.evaluate((nextHash) => {
      window.location.hash = nextHash;
    }, hash);
    await expect(page).toHaveURL(new RegExp(hash.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  };
  for (let cycle = 1; cycle <= 20; cycle += 1) {
    await navigateHash(`#/routes/${ROUTE_SLUG}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await navigateHash(`#/replay/${ROUTE_SLUG}?renderer=atlas`);
    await waitForReplay(page);
    await navigateHash("#/atlas");
    await waitForAtlas(page);
    const client = await page.context().newCDPSession(page);
    await client.send("HeapProfiler.collectGarbage");
    const heap = await client.send("Runtime.getHeapUsage");
    const webglContextsCreated = await page.evaluate(
      () => window.__runtimePerf?.webglContexts.size ?? 0,
    );
    await client.detach();
    transitionHeap.push({ cycle, usedHeapBytes: heap.usedSize, webglContextsCreated });
  }

  await writeProjectReport(testInfo.project.name, samples, { transitionHeap });
  expect(samples).toHaveLength(6);
  expect(transitionHeap).toHaveLength(20);
});

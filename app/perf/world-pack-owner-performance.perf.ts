import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Page,
} from "@playwright/test";
import { PNG } from "pngjs";

const BASE_URL = "http://127.0.0.1:8798";
const CAPTURE = process.env.GODIESEL_CAPTURE_WORLD_PACK_PERFORMANCE === "1";
const OUTPUT = path.resolve(
  process.cwd(),
  "../docs/world-packs/proof/owner-mac-performance.json",
);
const ROUTES = [
  { routeSlug: "17665674778", worldId: "tokyo-urban" },
  { routeSlug: "15573295095", worldId: "banff-mountain" },
  { routeSlug: "6496900063", worldId: "ucluelet-coastal" },
] as const;
const FRAME_SAMPLE_MS = 8_000;
const MEMORY_CYCLES = 3;

interface WebglSnapshot {
  activeContexts: number;
  connectedCanvases: number;
  totalContextsCreated: number;
}

interface RuntimeSnapshot {
  firstMeaningfulAtMs?: number;
  physicalReadyAtMs?: number;
  webgl: WebglSnapshot;
}

declare global {
  interface Window {
    __worldPackPerformance?: {
      snapshot: () => RuntimeSnapshot;
    };
  }
}

test.setTimeout(600_000);

async function instrument(context: BrowserContext) {
  await context.addInitScript(() => {
    type WebglRecord = {
      canvas: HTMLCanvasElement;
      context: WebGLRenderingContext | WebGL2RenderingContext;
      lost: boolean;
    };
    const records = new Map<HTMLCanvasElement, WebglRecord>();
    let totalContextsCreated = 0;
    let firstMeaningfulAtMs: number | undefined;
    let physicalReadyAtMs: number | undefined;
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      ...args: Parameters<typeof originalGetContext>
    ) {
      const context = originalGetContext.apply(this, args as never);
      const kind = args[0];
      const isWebgl =
        kind === "webgl" || kind === "webgl2" || kind === "experimental-webgl";
      if (context && isWebgl && !records.has(this)) {
        const record: WebglRecord = {
          canvas: this,
          context: context as WebGLRenderingContext | WebGL2RenderingContext,
          lost: false,
        };
        records.set(this, record);
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

    const scan = () => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        'canvas[data-world-pack-meaningful-view="true"], canvas[aria-label="Verified local World Pack"]',
      );
      if (canvas && firstMeaningfulAtMs === undefined) {
        requestAnimationFrame(() => {
          firstMeaningfulAtMs ??= performance.now();
        });
      }
      if (
        canvas?.dataset.worldPackState === "ready" &&
        physicalReadyAtMs === undefined
      ) {
        physicalReadyAtMs = performance.now();
      }
    };
    new MutationObserver(scan).observe(document, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: [
        "aria-label",
        "data-world-pack-meaningful-view",
        "data-world-pack-state",
      ],
    });

    window.__worldPackPerformance = {
      snapshot() {
        const connected = [...records.values()].filter(
          ({ canvas }) => canvas.isConnected,
        );
        return {
          firstMeaningfulAtMs,
          physicalReadyAtMs,
          webgl: {
            activeContexts: connected.filter(
              ({ context, lost }) => !lost && !context.isContextLost(),
            ).length,
            connectedCanvases: connected.length,
            totalContextsCreated,
          },
        };
      },
    };
  });
}

async function blockProviders(page: Page) {
  const externalRequests: string[] = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === BASE_URL || url.protocol === "data:" || url.protocol === "blob:") {
      await route.continue();
      return;
    }
    externalRequests.push(url.href);
    await route.abort("blockedbyclient");
  });
  return externalRequests;
}

async function runtimeSnapshot(page: Page) {
  const snapshot = await page.evaluate(() => window.__worldPackPerformance?.snapshot());
  if (!snapshot) throw new Error("World Pack performance instrumentation is absent.");
  return snapshot;
}

async function waitForWorld(page: Page, routeSlug: string) {
  await page.goto(`/#/lab/playable-earth/${routeSlug}`, {
    waitUntil: "domcontentloaded",
  });
  const lab = page.getByRole("region", { name: "Playable Earth Lab" });
  await expect(lab).toHaveAttribute("data-physical-ready", "true", {
    timeout: 30_000,
  });
  const canvas = page.locator('canvas[aria-label="Verified local World Pack"]');
  await expect(canvas).toHaveAttribute("data-world-pack-state", "ready");
  return { canvas, lab };
}

function percentile(values: readonly number[], quantile: number) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)] ?? 0;
}

async function frameMetrics(page: Page) {
  const intervals = await page.evaluate(
    (durationMs) =>
      new Promise<number[]>((resolve) => {
        const values: number[] = [];
        const startedAt = performance.now();
        let previous = startedAt;
        const sample = (now: number) => {
          if (now > previous) values.push(now - previous);
          previous = now;
          if (now - startedAt < durationMs) requestAnimationFrame(sample);
          else resolve(values);
        };
        requestAnimationFrame(sample);
      }),
    FRAME_SAMPLE_MS,
  );
  return {
    sampleDurationMs: FRAME_SAMPLE_MS,
    frameCount: intervals.length,
    p50Ms: percentile(intervals, 0.5),
    p95Ms: percentile(intervals, 0.95),
    p99Ms: percentile(intervals, 0.99),
    maximumMs: Math.max(...intervals),
    over33Ms: intervals.filter((interval) => interval > 33).length,
  };
}

async function quantizedColorBins(page: Page) {
  const buffer = await page
    .locator('canvas[aria-label="Verified local World Pack"]')
    .screenshot();
  const png = PNG.sync.read(buffer);
  const colors = new Set<number>();
  for (let index = 0; index < png.data.length; index += 64) {
    colors.add(
      ((png.data[index] >> 4) << 8) |
        ((png.data[index + 1] >> 4) << 4) |
        (png.data[index + 2] >> 4),
    );
  }
  return colors.size;
}

async function webglRenderer(page: Page) {
  return await page
    .locator('canvas[aria-label="Verified local World Pack"]')
    .evaluate((element: HTMLCanvasElement) => {
      const context =
        element.getContext("webgl2") ?? element.getContext("webgl");
      const extension = context?.getExtension("WEBGL_debug_renderer_info");
      return extension
        ? String(context.getParameter(extension.UNMASKED_RENDERER_WEBGL))
        : "unavailable";
    });
}

async function collectHeap(client: CDPSession) {
  await client.send("HeapProfiler.collectGarbage");
  await new Promise((resolve) => setTimeout(resolve, 750));
  await client.send("HeapProfiler.collectGarbage");
  return await client.send("Runtime.getHeapUsage");
}

async function leaveWorld(page: Page) {
  await page.goto("/#/routes", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("region", { name: "Route results" })).toBeVisible();
}

async function warmAllWorlds(page: Page) {
  for (const route of ROUTES) {
    await waitForWorld(page, route.routeSlug);
    expect((await runtimeSnapshot(page)).webgl.activeContexts).toBeLessThanOrEqual(1);
    await leaveWorld(page);
    await expect.poll(async () => (await runtimeSnapshot(page)).webgl.activeContexts).toBe(0);
  }
}

test("meets the Core World Pack owner-Mac performance gate", async ({ browser }) => {
  const browserVersion = browser.version();
  const worlds = [];
  for (const route of ROUTES) {
    const context = await browser.newContext({
      baseURL: BASE_URL,
      viewport: { width: 1440, height: 900 },
    });
    await instrument(context);
    const page = await context.newPage();
    const externalRequests = await blockProviders(page);
    const startedAt = performance.now();
    const { canvas } = await waitForWorld(page, route.routeSlug);
    const packId = await canvas.getAttribute("data-world-pack-id");
    expect(packId).toMatch(/^wp_[a-f0-9]{64}$/);
    const readyWallMs = performance.now() - startedAt;
    const snapshot = await runtimeSnapshot(page);
    const navigation = await page.evaluate(() =>
      performance.getEntriesByType("navigation")[0]?.toJSON(),
    );
    const navigationOriginMs = Number(navigation?.startTime ?? 0);
    const firstMeaningfulMs =
      snapshot.firstMeaningfulAtMs === undefined
        ? readyWallMs
        : snapshot.firstMeaningfulAtMs - navigationOriginMs;
    const physicalReadyMs =
      snapshot.physicalReadyAtMs === undefined
        ? readyWallMs
        : snapshot.physicalReadyAtMs - navigationOriginMs;
    const colorBins = await quantizedColorBins(page);
    const renderer = await webglRenderer(page);
    const frames = await frameMetrics(page);
    await expect(canvas).toHaveAttribute("data-network-required", "false");
    expect(firstMeaningfulMs).toBeLessThanOrEqual(3_000);
    expect(physicalReadyMs).toBeLessThanOrEqual(8_000);
    expect(frames.p95Ms).toBeLessThanOrEqual(33);
    expect(snapshot.webgl.activeContexts).toBeLessThanOrEqual(1);
    expect(snapshot.webgl.connectedCanvases).toBeLessThanOrEqual(1);
    expect(colorBins).toBeGreaterThan(12);
    expect(externalRequests).toEqual([]);
    worlds.push({
      ...route,
      packId,
      firstMeaningfulMs,
      physicalReadyMs,
      quantizedColorBins: colorBins,
      webglRenderer: renderer,
      frames,
      webgl: snapshot.webgl,
      providerRequests: externalRequests.length,
    });
    await context.close();
  }

  const memoryContext = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: 1440, height: 900 },
  });
  await instrument(memoryContext);
  const memoryPage = await memoryContext.newPage();
  const memoryExternalRequests = await blockProviders(memoryPage);
  const client = await memoryContext.newCDPSession(memoryPage);
  await warmAllWorlds(memoryPage);
  const baseline = await collectHeap(client);
  const cycleSettledUsedBytes = [];
  for (let cycle = 1; cycle <= MEMORY_CYCLES; cycle += 1) {
    await warmAllWorlds(memoryPage);
    cycleSettledUsedBytes.push((await collectHeap(client)).usedSize);
  }
  const settledUsedBytes = cycleSettledUsedBytes.at(-1) ?? baseline.usedSize;
  const settledGrowthRatio = Math.max(
    0,
    (settledUsedBytes - baseline.usedSize) / baseline.usedSize,
  );
  expect(settledGrowthRatio).toBeLessThanOrEqual(0.1);
  expect((await runtimeSnapshot(memoryPage)).webgl.activeContexts).toBe(0);
  expect(memoryExternalRequests).toEqual([]);
  await client.detach();
  await memoryContext.close();

  const proof = {
    schemaVersion: 1,
    capturedOn: "2026-08-29",
    conditions: {
      browser: `Chromium ${browserVersion}`,
      cpu: os.cpus()[0]?.model ?? "unknown",
      logicalCpuCount: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
      platform: `${os.platform()} ${os.arch()} ${os.release()}`,
      viewport: { width: 1440, height: 900 },
      qualityTier: "core",
      network: "all non-local requests blocked",
      source: "local production build and sealed World Packs",
      webglRenderers: [...new Set(worlds.map((world) => world.webglRenderer))],
    },
    thresholds: {
      firstMeaningfulMs: 3_000,
      physicalReadyMs: 8_000,
      frameP95Ms: 33,
      activeWebglContexts: 1,
      settledMemoryGrowthRatio: 0.1,
    },
    worlds,
    memory: {
      warmupWorldEntries: ROUTES.length,
      measuredCycles: MEMORY_CYCLES,
      worldEntriesPerCycle: ROUTES.length,
      baselineUsedBytes: baseline.usedSize,
      cycleSettledUsedBytes,
      settledUsedBytes,
      settledGrowthRatio,
      providerRequests: memoryExternalRequests.length,
    },
  };
  if (CAPTURE) {
    fs.writeFileSync(OUTPUT, `${JSON.stringify(proof, null, 2)}\n`, "utf8");
  }
});

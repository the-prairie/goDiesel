import {
  expect,
  test,
  type BrowserContext,
  type CDPSession,
  type Locator,
  type Page,
} from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

const OUTPUT_DIR = path.resolve(process.cwd(), "artifacts/world-pack-baseline");
const TOTAL_OBSERVATION_MS = Number(
  process.env.GODIESEL_WORLD_LIVE_BASELINE_MS ?? 600_000,
);
const CAPTURE = process.env.GODIESEL_CAPTURE_WORLD_LIVE_BASELINE === "1";
const ROUTES = [
  { id: "tokyo-urban", slug: "17665674778", region: "Tokyo, Japan" },
  { id: "banff-mountain", slug: "15573295095", region: "Banff/Kananaskis" },
  { id: "ucluelet-coastal", slug: "6496900063", region: "Ucluelet, BC" },
] as const;

interface FrameMetrics {
  durationMs: number;
  frameCount: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maximumMs: number;
  over33Ms: number;
}

interface HeapMetrics {
  startUsedBytes: number;
  peakUsedBytes: number;
  settledUsedBytes: number;
  settledTotalBytes: number;
}

interface WebglMetrics {
  activeContexts: number;
  connectedCanvases: number;
  totalContextsCreated: number;
}

declare global {
  interface Window {
    __worldPackBaseline?: {
      webgl: () => WebglMetrics;
    };
  }
}

async function installWebglInstrumentation(context: BrowserContext) {
  await context.addInitScript(() => {
    type WebglRecord = {
      canvas: HTMLCanvasElement;
      context: WebGLRenderingContext | WebGL2RenderingContext;
      lost: boolean;
    };

    const records = new Map<HTMLCanvasElement, WebglRecord>();
    let totalContextsCreated = 0;
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

    window.__worldPackBaseline = {
      webgl() {
        const connected = [...records.values()].filter(
          ({ canvas }) => canvas.isConnected,
        );
        return {
          activeContexts: connected.filter(
            ({ context, lost }) => !lost && !context.isContextLost(),
          ).length,
          connectedCanvases: connected.length,
          totalContextsCreated,
        };
      },
    };
  });
}

function requestCategory(urlValue: string) {
  if (urlValue.startsWith("blob:")) return "blob:runtime-object";
  const url = new URL(urlValue);
  if (url.origin === "http://localhost:8797") {
    if (url.pathname.startsWith("/assets/")) return `${url.origin}/assets`;
    if (url.pathname.startsWith("/cesiumStatic/")) {
      return `${url.origin}/cesium-static`;
    }
    if (url.pathname.startsWith("/data/routes/")) {
      return `${url.origin}/route-detail`;
    }
    return `${url.origin}/application`;
  }
  if (url.origin === "https://cesium.com") {
    return `${url.origin}/cesium-runtime`;
  }
  if (url.origin === "https://fonts.googleapis.com") {
    return `${url.origin}/font-css`;
  }
  if (url.origin === "https://fonts.gstatic.com") {
    return `${url.origin}/font-file`;
  }
  if (url.pathname.includes("/BulkMetadata/")) {
    return `${url.origin}/BulkMetadata`;
  }
  if (url.pathname.includes("/NodeData/")) {
    return `${url.origin}/NodeData`;
  }
  if (
    url.pathname.includes("/v1/3dtiles/datasets/") &&
    url.pathname.includes("/files/")
  ) {
    const extension = path.extname(url.pathname) || "other";
    return `${url.origin}/v1/3dtiles/files/${extension.replace(".", "")}`;
  }
  if (url.origin === "https://maps.googleapis.com") {
    if (url.pathname === "/maps/api/js") return `${url.origin}/maps-api-js`;
    if (url.pathname.includes("/maps-api-v3/")) {
      return `${url.origin}/maps-api-v3-runtime`;
    }
    if (url.pathname.includes("/maps/api/staticmap")) {
      return `${url.origin}/static-map`;
    }
    return `${url.origin}/maps-runtime`;
  }
  return `${url.origin}${url.pathname}`;
}

function increment(counter: Map<string, number>, key: string) {
  counter.set(key, (counter.get(key) ?? 0) + 1);
}

function sortedCounts(counter: Map<string, number>) {
  return [...counter]
    .map(([category, count]) => ({ category, count }))
    .sort((left, right) => left.category.localeCompare(right.category));
}

async function freshNavigation(page: Page, target: string) {
  await page.goto("about:blank");
  const started = performance.now();
  await page.goto(target, { waitUntil: "domcontentloaded" });
  return started;
}

async function measureFrames(
  page: Page,
  durationMs: number,
): Promise<FrameMetrics> {
  return page.evaluate(
    (windowMs) =>
      new Promise<FrameMetrics>((resolve) => {
        const intervals: number[] = [];
        const started = performance.now();
        let previous = started;
        const tick = (now: number) => {
          if (now > previous) intervals.push(now - previous);
          previous = now;
          if (now - started < windowMs) {
            requestAnimationFrame(tick);
            return;
          }
          const sorted = [...intervals].sort((left, right) => left - right);
          const percentile = (quantile: number) =>
            sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)] ?? 0;
          resolve({
            durationMs: now - started,
            frameCount: intervals.length,
            p50Ms: percentile(0.5),
            p95Ms: percentile(0.95),
            p99Ms: percentile(0.99),
            maximumMs: sorted.at(-1) ?? 0,
            over33Ms: intervals.filter((interval) => interval > 33).length,
          });
        };
        requestAnimationFrame(tick);
      }),
    durationMs,
  );
}

async function measureHeap(
  client: CDPSession,
  durationMs: number,
): Promise<HeapMetrics> {
  const start = await client.send("Runtime.getHeapUsage");
  let peakUsedBytes = start.usedSize;
  const sampleEveryMs = Math.max(
    500,
    Math.min(5_000, Math.floor(durationMs / 4)),
  );
  const deadline = performance.now() + durationMs;
  let settled = start;
  while (performance.now() + sampleEveryMs < deadline) {
    await new Promise((resolve) => setTimeout(resolve, sampleEveryMs));
    settled = await client.send("Runtime.getHeapUsage");
    peakUsedBytes = Math.max(peakUsedBytes, settled.usedSize);
  }
  const remainingMs = Math.max(0, deadline - performance.now());
  if (remainingMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, remainingMs));
  }
  settled = await client.send("Runtime.getHeapUsage");
  peakUsedBytes = Math.max(peakUsedBytes, settled.usedSize);
  return {
    startUsedBytes: start.usedSize,
    peakUsedBytes,
    settledUsedBytes: settled.usedSize,
    settledTotalBytes: settled.totalSize,
  };
}

async function measureSurface(page: Page, durationMs: number) {
  const client = await page.context().newCDPSession(page);
  try {
    const [frames, heap] = await Promise.all([
      measureFrames(page, durationMs),
      measureHeap(client, durationMs),
    ]);
    const webgl = await page.evaluate(() =>
      window.__worldPackBaseline?.webgl(),
    );
    if (!webgl)
      throw new Error("World Pack WebGL instrumentation is unavailable");
    return { frames, heap, webgl };
  } finally {
    await client.detach();
  }
}

async function captureScreenshot(page: Page, name: string) {
  if (!CAPTURE) return;
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(OUTPUT_DIR, `${name}.png`),
    fullPage: false,
  });
}

async function stageState(stage: Locator) {
  return {
    state: await stage.getAttribute("data-state"),
    canvasCount: await stage.locator("canvas").count(),
  };
}

async function replayProgressM(replay: Locator) {
  const value = await replay.getByTestId("google-route-progress").textContent();
  const kilometres = Number(value?.match(/[\d.]+/)?.[0] ?? "0");
  return kilometres * 1_000;
}

test("records the three-reference-world live baseline", async ({
  context,
  page,
}) => {
  test.skip(
    process.env.GODIESEL_WORLD_LIVE_BASELINE !== "1",
    "Set GODIESEL_WORLD_LIVE_BASELINE=1 with the real provider credential.",
  );
  expect(TOTAL_OBSERVATION_MS).toBeGreaterThanOrEqual(18_000);
  const surfaceWindowMs = Math.floor(
    TOTAL_OBSERVATION_MS / (ROUTES.length * 3),
  );
  const failedRequests = new Map<string, number>();
  const responseErrors = new Map<string, number>();
  const requests = new Map<string, number>();
  await installWebglInstrumentation(context);
  page.on("request", (request) => {
    if (!request.url().startsWith("data:")) {
      increment(requests, requestCategory(request.url()));
    }
  });
  page.on("requestfailed", (request) => {
    if (!request.url().startsWith("data:")) {
      increment(
        failedRequests,
        `${requestCategory(request.url())} ${request.failure()?.errorText ?? "unknown"}`,
      );
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      increment(
        responseErrors,
        `${response.status()} ${requestCategory(response.url())}`,
      );
    }
  });

  const routeEvidence = [];
  for (const route of ROUTES) {
    const atlasStarted = await freshNavigation(
      page,
      `/#/atlas?region=${encodeURIComponent(route.region)}`,
    );
    const atlas = page.locator('div[data-atlas-engine="cesium"]');
    await expect(atlas).toHaveAttribute("data-atlas-status", "region-ready");
    const atlasReadyMs = performance.now() - atlasStarted;
    const atlasRuntime = await measureSurface(page, surfaceWindowMs);
    await captureScreenshot(page, `${route.id}-atlas-live`);
    const atlasEvidence = {
      state: await atlas.getAttribute("data-atlas-status"),
      readyMs: atlasReadyMs,
      canvasCount: await atlas.locator("canvas").count(),
      regionRouteCount: await atlas.getAttribute("data-region-route-count"),
      cameraRangeM: await atlas.getAttribute("data-camera-range"),
      ...atlasRuntime,
    };

    const replayStarted = await freshNavigation(
      page,
      `/#/replay/${route.slug}`,
    );
    const replay = page.locator('section[data-engine="google-3d-maps"]');
    await expect(replay).toHaveAttribute("data-state", "ready");
    const replayReadyMs = performance.now() - replayStarted;
    const replayStartProgress = await replayProgressM(replay);
    await replay.getByRole("button", { name: "Play route" }).click();
    const replayRuntime = await measureSurface(page, surfaceWindowMs);
    const replayEndProgress = await replayProgressM(replay);
    expect(replayEndProgress).toBeGreaterThan(replayStartProgress);
    await captureScreenshot(page, `${route.id}-replay-live`);
    const replayEvidence = {
      ...(await stageState(replay)),
      readyMs: replayReadyMs,
      startProgressM: replayStartProgress,
      endProgressM: replayEndProgress,
      progressMonotonic: replayEndProgress > replayStartProgress,
      ...replayRuntime,
    };

    const playableStarted = await freshNavigation(
      page,
      `/#/lab/playable-earth/${route.slug}`,
    );
    const playable = page.locator('section[aria-label="Playable Earth Lab"]');
    await expect(playable).toHaveAttribute("data-state", "ready");
    const playableReadyMs = performance.now() - playableStarted;
    const progressControl = playable.getByRole("slider", {
      name: "Route progress",
    });
    const playableStartProgress = Number(await progressControl.inputValue());
    await playable.getByRole("button", { name: "Play route" }).click();
    const playableRuntime = await measureSurface(page, surfaceWindowMs);
    const playableEndProgress = Number(await progressControl.inputValue());
    expect(playableEndProgress).toBeGreaterThan(playableStartProgress);
    await captureScreenshot(page, `${route.id}-playable-live`);
    const playableEvidence = {
      ...(await stageState(playable)),
      readyMs: playableReadyMs,
      startProgressM: playableStartProgress,
      endProgressM: playableEndProgress,
      progressMonotonic: playableEndProgress > playableStartProgress,
      groundingSource: await playable.getAttribute("data-grounding-source"),
      groundingReason: await playable.getAttribute("data-grounding-reason"),
      groundingOffsetM: await playable.getAttribute("data-grounding-offset"),
      ...playableRuntime,
    };

    routeEvidence.push({
      ...route,
      atlas: atlasEvidence,
      replay: replayEvidence,
      playable: playableEvidence,
    });
  }

  const evidence = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    conditions: {
      project: "owner-mac-desktop-chromium",
      viewport: { width: 1440, height: 900 },
      totalObservationMs: TOTAL_OBSERVATION_MS,
      surfaceObservationMs: surfaceWindowMs,
      liveProvidersDisabled: false,
      providerCredentialConfigured: Boolean(
        process.env.VITE_GOOGLE_MAPS_API_KEY?.trim() ||
        process.env.GOOGLE_MAPS_API_KEY?.trim(),
      ),
    },
    routes: routeEvidence,
    network: {
      requests: sortedCounts(requests),
      failedRequests: sortedCounts(failedRequests),
      responseErrors: sortedCounts(responseErrors),
    },
  };

  if (CAPTURE) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(OUTPUT_DIR, "live-reference-runtime.json"),
      `${JSON.stringify(evidence, null, 2)}\n`,
      "utf8",
    );
  }
});

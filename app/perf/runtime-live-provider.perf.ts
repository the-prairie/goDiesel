import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { expect, test } from "@playwright/test";

const RUN_ID = process.env.GODIESEL_PERF_RUN_ID?.trim();
const OUTPUT_DIR = path.resolve(
  process.cwd(),
  RUN_ID
    ? `artifacts/runtime-statistics/raw/${RUN_ID}/live`
    : "artifacts/runtime-performance",
);
const requested = process.env.GODIESEL_LIVE_PROVIDER_PERF === "1";
const SOURCE_COMMIT = process.env.GODIESEL_PERF_SOURCE_COMMIT?.trim();

function livePrerequisites() {
  const expectedHostname = process.env.GODIESEL_FIXED_GPU_HOSTNAME?.trim();
  if (!expectedHostname) {
    throw new Error(
      "GODIESEL_FIXED_GPU_HOSTNAME must name the approved reference host",
    );
  }
  const actualHostname = os.hostname();
  if (actualHostname !== expectedHostname) {
    throw new Error(
      `Live provider performance must run on ${expectedHostname}; received ${actualHostname}`,
    );
  }
  const providerCredentialConfigured = Boolean(
    process.env.VITE_GOOGLE_MAPS_API_KEY?.trim() ||
    process.env.GOOGLE_MAPS_API_KEY?.trim(),
  );
  if (!providerCredentialConfigured) {
    throw new Error("A real Google Maps provider credential is required");
  }
  return { actualHostname, expectedHostname, providerCredentialConfigured };
}

test("records fixed-host regional provider settlement", async ({
  page,
}, testInfo) => {
  test.skip(
    !requested,
    "Set GODIESEL_LIVE_PROVIDER_PERF=1 and GODIESEL_FIXED_GPU_HOSTNAME on the fixed GPU host with provider credentials.",
  );
  const prerequisites = livePrerequisites();
  if (!SOURCE_COMMIT) {
    throw new Error(
      "GODIESEL_PERF_SOURCE_COMMIT is required for live evidence",
    );
  }
  const client = await page.context().newCDPSession(page);
  await client.send("Performance.enable");
  await client.send("Profiler.enable");
  await client.send("HeapProfiler.enable");
  await client.send("HeapProfiler.collectGarbage");
  const heapBefore = await client.send("Runtime.getHeapUsage");
  await client.send("Profiler.start");

  const started = performance.now();
  await page.goto("/#/atlas", { waitUntil: "domcontentloaded" });
  const localApplicationReadyMs = performance.now() - started;
  const atlas = page.locator('div[data-atlas-engine="cesium"]');
  await expect(atlas).toHaveAttribute("data-atlas-status", "ready", {
    timeout: 120_000,
  });
  const globalReadyMs = performance.now() - started;
  const globalProviderSettlementMs = globalReadyMs - localApplicationReadyMs;
  const gpu = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl");
    if (!gl) return { accelerated: false, renderer: "WebGL unavailable" };
    const extension = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = extension
      ? String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL))
      : String(gl.getParameter(gl.RENDERER));
    return {
      accelerated: !/swiftshader|software|llvmpipe/i.test(renderer),
      renderer,
    };
  });
  if (!gpu.accelerated) {
    throw new Error(
      `Hardware acceleration is required; renderer=${gpu.renderer}`,
    );
  }

  const regionButton = page.getByRole("button", {
    name: /Select Kyoto, Japan on globe/i,
  });
  await expect(regionButton).toBeVisible({ timeout: 60_000 });
  const regionalStarted = performance.now();
  await regionButton.click();
  await expect(atlas).toHaveAttribute("data-atlas-status", "region-ready", {
    timeout: 180_000,
  });
  const regionalSettlementMs = performance.now() - regionalStarted;
  const status = await atlas.getAttribute("data-atlas-status");
  const performanceMetrics = await client.send("Performance.getMetrics");
  const heapAfter = await client.send("Runtime.getHeapUsage");
  const { profile } = await client.send("Profiler.stop");
  const resources = await page.evaluate(() =>
    (
      performance.getEntriesByType("resource") as PerformanceResourceTiming[]
    ).map((resource) => ({
      name: resource.name.replace(location.origin, ""),
      startTime: resource.startTime,
      duration: resource.duration,
      transferSize: resource.transferSize,
      decodedBodySize: resource.decodedBodySize,
      initiatorType: resource.initiatorType,
      origin: resource.name.startsWith(location.origin) ? "local" : "provider",
    })),
  );

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const profilePath = path.join(
    OUTPUT_DIR,
    `runtime-live-provider-${testInfo.project.name}-r${String(testInfo.repeatEachIndex).padStart(3, "0")}.cpuprofile`,
  );
  fs.writeFileSync(profilePath, `${JSON.stringify(profile)}\n`);
  fs.writeFileSync(
    path.join(
      OUTPUT_DIR,
      RUN_ID
        ? `runtime-live-provider-${testInfo.project.name}-r${String(testInfo.repeatEachIndex).padStart(3, "0")}.json`
        : `runtime-live-provider-${testInfo.project.name}.json`,
    ),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        sourceCommit: SOURCE_COMMIT,
        generatedAt: new Date().toISOString(),
        projectName: testInfo.project.name,
        runId: RUN_ID,
        repetitionIndex: testInfo.repeatEachIndex,
        globalReadyMs,
        localApplicationReadyMs,
        globalProviderSettlementMs,
        regionalSettlementMs,
        regionalStatus: status,
        prerequisites: {
          fixedGpuHost:
            prerequisites.actualHostname === prerequisites.expectedHostname,
          fixedGpuHostname: prerequisites.actualHostname,
          providerCredentialConfigured:
            prerequisites.providerCredentialConfigured,
          liveProvidersDisabled: false,
          hardwareAccelerated: gpu.accelerated,
          gpuRenderer: gpu.renderer,
        },
        heap: { before: heapBefore, after: heapAfter },
        performanceMetrics: Object.fromEntries(
          performanceMetrics.metrics.map((metric) => [
            metric.name,
            metric.value,
          ]),
        ),
        resources,
        cpuProfile: path.relative(process.cwd(), profilePath),
      },
      null,
      2,
    )}\n`,
  );
});

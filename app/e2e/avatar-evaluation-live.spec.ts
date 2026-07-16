import { expect, test, type Locator, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { PNG } from "pngjs";

const liveAvatarEnabled = process.env.GODIESEL_LIVE_AVATAR_E2E === "1";
const benchmarkEnabled = process.env.GODIESEL_AVATAR_BENCHMARK === "1";
const routeSlug = "17654151284";
const avatarRuntimePattern =
  /(?:route-avatars|avatar-lab|riveStatic|rive(?:\.wasm)?|lottie)/i;

const renderers = [
  { id: "dotlottie", tab: "Custom dotLottie", mobileTab: "Lottie" },
  { id: "cesium-glb", tab: "Native Cesium GLB", mobileTab: "GLB" },
  { id: "rive", tab: "Rive Canvas Lite", mobileTab: "Rive" },
] as const;

function countVisiblePixels(screenshot: Buffer) {
  const png = PNG.sync.read(screenshot);
  let visible = 0;
  const stride = Math.max(1, Math.floor((png.width * png.height) / 50_000));
  for (let pixel = 0; pixel < png.width * png.height; pixel += stride) {
    const offset = pixel * 4;
    if (
      png.data[offset + 3] > 20 &&
      png.data[offset] + png.data[offset + 1] + png.data[offset + 2] > 30
    ) {
      visible += 1;
    }
  }
  return visible;
}

async function waitForLiveWorld(stage: Locator) {
  await expect(stage).toHaveAttribute("data-state", /ready|partial/, {
    timeout: 60_000,
  });
  await expect(stage).toHaveAttribute("data-renderer-state", "ready", {
    timeout: 20_000,
  });
}

async function assertWorldPixels(page: Page) {
  await page.waitForTimeout(1_500);
  const screenshot = await page.getByLabel("Avatar evaluation world").screenshot();
  expect(countVisiblePixels(screenshot)).toBeGreaterThan(2_000);
  return screenshot;
}

async function assertOverlayAvatarPixels(page: Page) {
  const avatar = page.getByRole("img", { name: /route avatar$/ });
  await expect(avatar).toBeVisible();
  expect(countVisiblePixels(await avatar.screenshot())).toBeGreaterThan(100);
}

test.describe("live avatar evaluation visuals", () => {
  test.skip(
    !liveAvatarEnabled,
    "Set GODIESEL_LIVE_AVATAR_E2E=1 to exercise live photorealistic tiles.",
  );

  test("all systems render and remain controllable at near, mid, and far", async ({
    page,
  }, testInfo) => {
    test.setTimeout(600_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    const assetRequests: string[] = [];
    const failedAssetRequests: string[] = [];
    const failedAssetResponses: Array<{ url: string; status: number }> = [];
    let tilesetRootRequests = 0;
    page.on("request", (request) => {
      if (avatarRuntimePattern.test(request.url())) {
        assetRequests.push(request.url());
      }
      if (request.url().includes("/v1/3dtiles/root.json")) {
        tilesetRootRequests += 1;
      }
    });
    page.on("requestfailed", (request) => {
      if (avatarRuntimePattern.test(request.url())) {
        failedAssetRequests.push(request.url());
      }
    });
    page.on("response", (response) => {
      if (avatarRuntimePattern.test(response.url()) && !response.ok()) {
        failedAssetResponses.push({ url: response.url(), status: response.status() });
      }
    });
    await page.goto(`/#/lab/avatar-evaluation/${routeSlug}`);

    const stage = page.getByTestId("avatar-evaluation-stage");
    await waitForLiveWorld(stage);
    const tilesetRootRequestsAtReady = tilesetRootRequests;
    for (const renderer of renderers) {
      await page.getByRole("tab", { name: renderer.tab }).click({ force: true });
      await waitForLiveWorld(stage);
      await expect(stage).toHaveAttribute("data-system", renderer.id);
      if (renderer.id === "cesium-glb") {
        await expect(page.getByLabel("Avatar evaluation world")).toHaveAttribute(
          "data-avatar-animation",
          /ready|static/,
          { timeout: 20_000 },
        );
      } else {
        await assertOverlayAvatarPixels(page);
      }

      for (const preset of ["Near", "Mid", "Far"] as const) {
        await page.getByRole("button", { name: preset }).click({ force: true });
        await assertWorldPixels(page);
        if (renderer.id !== "cesium-glb") {
          await assertOverlayAvatarPixels(page);
        }
        const screenshot = await stage.screenshot();
        await testInfo.attach(`${renderer.id}-${preset.toLowerCase()}`, {
          body: screenshot,
          contentType: "image/png",
        });
      }

      await page.getByLabel("Avatar evaluation progress").fill("8000");
      await page
        .getByRole("button", { name: /Evaluation playback speed/ })
        .click({ force: true });
      await page
        .getByRole("button", { name: "Play avatar evaluation" })
        .click({ force: true });
      const progress = Number(await stage.getAttribute("data-progress"));
      await expect
        .poll(async () => Number(await stage.getAttribute("data-progress")))
        .toBeGreaterThan(progress);
      await page
        .getByRole("button", { name: "Pause avatar evaluation" })
        .click({ force: true });

      expect(
        await page.getByLabel("Avatar evaluation world").locator("canvas").count(),
      ).toBe(1);
    }

    await page.getByRole("button", { name: "Reduced motion" }).click({ force: true });
    await expect(stage).toHaveAttribute("data-reduced-motion", "true");
    expect(assetRequests.length).toBeGreaterThan(0);
    expect(
      assetRequests.every((url) => new URL(url).origin === "http://127.0.0.1:8787"),
    ).toBe(true);
    expect(failedAssetRequests).toEqual([]);
    expect(failedAssetResponses).toEqual([]);
    expect(tilesetRootRequestsAtReady).toBeGreaterThanOrEqual(1);
    expect(tilesetRootRequests).toBe(tilesetRootRequestsAtReady);
  });

  test("renderer controls and world remain framed on mobile", async ({ page }, testInfo) => {
    test.setTimeout(480_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/#/lab/avatar-evaluation/${routeSlug}`);
    const stage = page.getByTestId("avatar-evaluation-stage");

    for (const renderer of renderers) {
      await page
        .getByRole("tab", { name: renderer.mobileTab, exact: true })
        .click({ force: true });
      await waitForLiveWorld(stage);
      await page.getByRole("button", { name: "Near" }).click({ force: true });
      await assertWorldPixels(page);
      if (renderer.id === "cesium-glb") {
        await expect(page.getByLabel("Avatar evaluation world")).toHaveAttribute(
          "data-avatar-animation",
          /ready|static/,
        );
      } else {
        await assertOverlayAvatarPixels(page);
      }
      await testInfo.attach(`mobile-${renderer.id}`, {
        body: await stage.screenshot(),
        contentType: "image/png",
      });
    }

    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    for (const control of [
      page.getByRole("button", { name: "Play avatar evaluation" }),
      page.getByRole("button", { name: /Evaluation playback speed/ }),
      page.getByRole("button", { name: "Motion" }),
    ]) {
      const box = await control.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
    await testInfo.attach("mobile-avatar-evaluation", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  });
});

test.describe("avatar evaluation five-minute lifecycle", () => {
  test.skip(
    !benchmarkEnabled,
    "Set GODIESEL_AVATAR_BENCHMARK=1 to run the five-minute lifecycle benchmark.",
  );

  test("plays every renderer for five sustained minutes and tears down", async ({
    page,
  }, testInfo) => {
    test.setTimeout(720_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    const client = await page.context().newCDPSession(page);
    await client.send("Performance.enable");
    const assetRequests: string[] = [];
    const failedAssetRequests: string[] = [];
    const failedAssetResponses: Array<{ url: string; status: number }> = [];
    let tilesetRootRequests = 0;
    const pageErrors: string[] = [];
    page.on("request", (request) => {
      if (avatarRuntimePattern.test(request.url())) {
        assetRequests.push(request.url());
      }
      if (request.url().includes("/v1/3dtiles/root.json")) {
        tilesetRootRequests += 1;
      }
    });
    page.on("requestfailed", (request) => {
      if (avatarRuntimePattern.test(request.url())) {
        failedAssetRequests.push(request.url());
      }
    });
    page.on("response", (response) => {
      if (avatarRuntimePattern.test(response.url()) && !response.ok()) {
        failedAssetResponses.push({ url: response.url(), status: response.status() });
      }
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(`/#/lab/avatar-evaluation/${routeSlug}`);

    const stage = page.getByTestId("avatar-evaluation-stage");
    const progress = page.getByLabel("Avatar evaluation progress");
    await waitForLiveWorld(stage);
    const tilesetRootRequestsAtReady = tilesetRootRequests;
    const samples: Array<{
      renderer: string;
      elapsedSeconds: number;
      heapBytes: number;
      nodes: number;
      documents: number;
      canvases: number;
      progressM: number;
    }> = [];
    const startedAt = Date.now();

    const collectMetrics = async (
      renderer: string,
      collectGarbage = false,
    ) => {
      if (collectGarbage) await client.send("HeapProfiler.collectGarbage");
      const metrics = await client.send("Performance.getMetrics");
      const metric = (name: string) =>
        metrics.metrics.find((candidate) => candidate.name === name)?.value ?? 0;
      const sample = {
        renderer,
        elapsedSeconds: Math.round((Date.now() - startedAt) / 1_000),
        heapBytes: metric("JSHeapUsedSize"),
        nodes: metric("Nodes"),
        documents: metric("Documents"),
        canvases: await page.locator("canvas").count(),
        progressM: Number(await stage.getAttribute("data-progress")),
      };
      samples.push(sample);
      return sample;
    };

    for (const renderer of renderers) {
      await page.getByRole("tab", { name: renderer.tab }).click({ force: true });
      await waitForLiveWorld(stage);
      await page.getByRole("button", { name: "Near" }).click({ force: true });
      await progress.fill("0");
      await page
        .getByRole("button", { name: "Play avatar evaluation" })
        .click({ force: true });
      await collectMetrics(renderer.id, true);
      const rendererDeadline = Date.now() + 100_000;

      while (Date.now() < rendererDeadline) {
        await page.waitForTimeout(
          Math.min(20_000, Math.max(1, rendererDeadline - Date.now())),
        );
        const max = Number(await progress.getAttribute("max"));
        const progressM = Number(await stage.getAttribute("data-progress"));
        if (progressM >= max - 10) {
          await progress.fill("0");
          await page
            .getByRole("button", { name: "Play avatar evaluation" })
            .click({ force: true });
        }
        await collectMetrics(renderer.id);
        expect(await page.getByLabel("Avatar evaluation world").locator("canvas").count()).toBe(
          1,
        );
        expect(samples.at(-1)?.canvases ?? 0).toBeLessThanOrEqual(3);
      }
      await collectMetrics(renderer.id, true);
      const pause = page.getByRole("button", { name: "Pause avatar evaluation" });
      if (await pause.isVisible()) await pause.click({ force: true });
    }

    const elapsedSeconds = (Date.now() - startedAt) / 1_000;
    const rendererHeapDrift = Object.fromEntries(
      renderers.map((renderer) => {
        const values = samples
          .filter((sample) => sample.renderer === renderer.id)
          .map((sample) => sample.heapBytes);
        return [renderer.id, values.at(-1)! - values[0]];
      }),
    );
    const assetRequestsDuringBenchmark = [...assetRequests];
    const failedAssetRequestsDuringBenchmark = [...failedAssetRequests];
    const failedAssetResponsesDuringBenchmark = [...failedAssetResponses];
    const tilesetRootRequestsAfterBenchmark = tilesetRootRequests;

    await page.getByRole("link", { name: "Exit avatar lab" }).click();
    await expect(page).toHaveURL(new RegExp(`#/replay/${routeSlug}$`));
    await expect(page.getByTestId("avatar-evaluation-stage")).toHaveCount(0);
    await page.goto("/#/routes");
    await expect(page.getByRole("heading", { name: "Your route library." })).toBeVisible();
    await client.send("HeapProfiler.collectGarbage");
    const postExitMetrics = await client.send("Performance.getMetrics");
    const postExitMetric = (name: string) =>
      postExitMetrics.metrics.find((candidate) => candidate.name === name)?.value ?? 0;
    const postExit = {
      heapBytes: postExitMetric("JSHeapUsedSize"),
      nodes: postExitMetric("Nodes"),
      documents: postExitMetric("Documents"),
      canvases: await page.locator("canvas").count(),
      cesiumViewers: await page.locator(".cesium-viewer").count(),
      currentDomNodes: await page.locator("*").count(),
    };
    await page.waitForTimeout(5_000);
    await client.send("HeapProfiler.collectGarbage");
    const settledMetrics = await client.send("Performance.getMetrics");
    const settledMetric = (name: string) =>
      settledMetrics.metrics.find((candidate) => candidate.name === name)?.value ?? 0;
    const postExitSettled = {
      heapBytes: settledMetric("JSHeapUsedSize"),
      nodes: settledMetric("Nodes"),
      documents: settledMetric("Documents"),
      canvases: await page.locator("canvas").count(),
      cesiumViewers: await page.locator(".cesium-viewer").count(),
      currentDomNodes: await page.locator("*").count(),
    };
    const evidence = {
      elapsedSeconds,
      assetRequests,
      assetRequestsDuringBenchmark,
      failedAssetRequests,
      failedAssetRequestsDuringBenchmark,
      failedAssetResponses,
      failedAssetResponsesDuringBenchmark,
      tilesetRootRequestsAtReady,
      tilesetRootRequestsAfterBenchmark,
      tilesetRootRequests,
      pageErrors,
      rendererHeapDrift,
      samples,
      postExit,
      postExitSettled,
    };
    const evidenceBody = JSON.stringify(evidence, null, 2);
    writeFileSync("/tmp/godiesel-avatar-benchmark.json", evidenceBody);
    await testInfo.attach("avatar-benchmark.json", {
      body: Buffer.from(evidenceBody),
      contentType: "application/json",
    });

    expect(elapsedSeconds).toBeGreaterThanOrEqual(300);
    expect(pageErrors).toEqual([]);
    expect(postExit.canvases).toBe(0);
    expect(postExit.cesiumViewers).toBe(0);
    expect(postExitSettled.canvases).toBe(0);
    expect(postExitSettled.cesiumViewers).toBe(0);
    expect(postExitSettled.documents).toBe(postExit.documents);
    expect(postExitSettled.currentDomNodes).toBe(postExit.currentDomNodes);
    for (const renderer of renderers) {
      const rendererSamples = samples.filter(
        (sample) => sample.renderer === renderer.id,
      );
      const expectedCanvases = renderer.id === "cesium-glb" ? 1 : 2;
      expect(rendererSamples.length).toBeGreaterThanOrEqual(6);
      expect(rendererSamples.at(-1)!.nodes - rendererSamples[0].nodes).toBeLessThan(
        120,
      );
      expect(rendererSamples.at(-1)!.documents).toBe(rendererSamples[0].documents);
      expect(
        new Set(rendererSamples.map((sample) => sample.canvases)),
      ).toEqual(new Set([expectedCanvases]));
      expect(rendererSamples.at(-1)!.progressM).toBeGreaterThan(
        rendererSamples[0]!.progressM + 500,
      );
    }
    expect(
      assetRequestsDuringBenchmark.every(
        (url) => new URL(url).origin === "http://127.0.0.1:8787",
      ),
    ).toBe(true);
    expect(failedAssetRequestsDuringBenchmark).toEqual([]);
    expect(failedAssetResponsesDuringBenchmark).toEqual([]);
    expect(tilesetRootRequestsAtReady).toBeGreaterThanOrEqual(1);
    expect(tilesetRootRequestsAfterBenchmark).toBe(tilesetRootRequestsAtReady);
  });
});

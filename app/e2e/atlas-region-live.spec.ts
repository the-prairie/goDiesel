import { expect, test } from "@playwright/test";
import { PNG } from "pngjs";

const previewUrl = process.env.GODIESEL_ATLAS_PREVIEW_URL;
if (!previewUrl) {
  throw new Error("Set GODIESEL_ATLAS_PREVIEW_URL to a deployed Pages preview.");
}

async function expectNonblankCanvas(canvas: import("@playwright/test").Locator) {
  const screenshot = PNG.sync.read(await canvas.screenshot());
  const colors = new Set<string>();
  for (let index = 0; index < screenshot.data.length; index += 512) {
    colors.add(
      `${screenshot.data[index]},${screenshot.data[index + 1]},${screenshot.data[index + 2]}`,
    );
  }
  expect(colors.size).toBeGreaterThan(64);
}

async function expectSelectedRouteContrast(
  canvas: import("@playwright/test").Locator,
) {
  const screenshot = PNG.sync.read(await canvas.screenshot());
  let coralPixels = 0;
  for (let index = 0; index < screenshot.data.length; index += 4) {
    const red = screenshot.data[index];
    const green = screenshot.data[index + 1];
    const blue = screenshot.data[index + 2];
    if (
      red > 150 &&
      green > 35 &&
      green < 150 &&
      blue < 135 &&
      red - green > 45 &&
      red - blue > 45
    ) {
      coralPixels += 1;
    }
  }
  expect(coralPixels).toBeGreaterThan(20);
  return coralPixels;
}

test.describe("live regional Atlas terrain", () => {
  test("global Atlas renders real route threads and keeps camera motion responsive", async ({
    page,
  }, testInfo) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${previewUrl}/#/atlas`);

    const world = page.locator('div[data-atlas-engine="cesium"]');
    const canvas = page.getByLabel("Interactive route globe");
    await expect(world).toHaveAttribute("data-atlas-status", "ready", {
      timeout: 30_000,
    });
    await expect(canvas).toHaveAttribute("data-heat-lines", "66");

    await page.evaluate(() => {
      const sample = { frames: 0, fps: 0, startedAt: performance.now() };
      (window as typeof window & { __atlasFrameSample?: typeof sample }).__atlasFrameSample =
        sample;
      const tick = (now: number) => {
        sample.frames += 1;
        const elapsed = now - sample.startedAt;
        if (elapsed < 2_000) requestAnimationFrame(tick);
        else sample.fps = (sample.frames * 1_000) / elapsed;
      };
      requestAnimationFrame(tick);
    });
    await page.getByRole("combobox", { name: "Browse route regions" }).selectOption({
      label: "Kyoto, Japan",
    });
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              (window as typeof window & {
                __atlasFrameSample?: { fps: number };
              }).__atlasFrameSample?.fps ?? 0,
          ),
        { timeout: 10_000 },
      )
      .toBeGreaterThanOrEqual(30);
    const frameSample = await page.evaluate(
      () =>
        (window as typeof window & {
          __atlasFrameSample?: { frames: number; fps: number };
        }).__atlasFrameSample,
    );
    await testInfo.attach("atlas-frame-sample", {
      body: Buffer.from(JSON.stringify(frameSample, null, 2)),
      contentType: "application/json",
    });

    await page.keyboard.press("Escape");
    await expect(world).toHaveAttribute("data-atlas-status", "ready", {
      timeout: 30_000,
    });
    await expectNonblankCanvas(canvas);
    await testInfo.attach("atlas-global", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  });

  for (const scenario of [
    { name: "Kyoto, Japan", maximumRangeM: 40_000 },
    { name: "Banff/Kananaskis", maximumRangeM: 200_000 },
  ]) {
    test(`${scenario.name} enters source-backed 3D terrain`, async ({
      page,
    }, testInfo) => {
      // Regional terrain streams Google photorealistic tiles for a whole
      // region, then this test reads pixels back. 90 seconds was not enough on
      // the first run that ever reached it.
      test.setTimeout(240_000);
      await page.setViewportSize({ width: 1440, height: 900 });
      const region = encodeURIComponent(scenario.name).replaceAll("%20", "+");
      await page.goto(`${previewUrl}/#/atlas?region=${region}`);

      const world = page.locator('div[data-atlas-engine="cesium"]');
      const canvas = page.getByLabel("Interactive route globe");
      await expect(world).toHaveAttribute("data-atlas-status", "region-ready", {
        timeout: 60_000,
      });
      await expect(canvas).toHaveAttribute("data-camera-state", "settled");
      await expect(canvas).toHaveAttribute("data-terrain-state", "ready");
      await expect(canvas).toHaveAttribute("data-camera-region", scenario.name);
      expect(Number(await canvas.getAttribute("data-region-camera-range"))).toBeLessThan(
        scenario.maximumRangeM,
      );
      expect(Number(await canvas.getAttribute("data-region-sphere-radius"))).toBeGreaterThan(
        500,
      );
      expect(Number(await canvas.getAttribute("data-region-route-count"))).toBeGreaterThan(
        0,
      );
      const carousel = page.getByRole("region", {
        name: `${scenario.name} recorded routes`,
        exact: true,
      });
      await expect(carousel).toBeVisible();
      await expect(carousel.locator('article[data-selected="true"]')).toHaveCount(1);
      const selectedSlug = await carousel
        .locator('article[data-selected="true"]')
        .getAttribute("data-route-slug");
      await expect(canvas).toHaveAttribute("data-selected-route", selectedSlug!);
      await expectNonblankCanvas(canvas);
      const coralPixels = await expectSelectedRouteContrast(canvas);
      await testInfo.attach(`${scenario.name}-selected-route-contrast`, {
        body: Buffer.from(JSON.stringify({ coralPixels }, null, 2)),
        contentType: "application/json",
      });
      await testInfo.attach(scenario.name.toLowerCase().replaceAll(/[^a-z]+/g, "-"), {
        body: await page.screenshot(),
        contentType: "image/png",
      });
    });
  }

  test("Kyoto regional terrain remains framed on mobile", async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${previewUrl}/#/atlas?region=Kyoto%2C+Japan`);

    const world = page.locator('div[data-atlas-engine="cesium"]');
    await expect(world).toHaveAttribute("data-atlas-status", "region-ready", {
      timeout: 60_000,
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    const carousel = page.getByRole("region", {
      name: "Kyoto, Japan recorded routes",
      exact: true,
    });
    await expect(carousel).toBeVisible();
    const carouselBox = (await carousel.boundingBox())!;
    const firstCardBox = (await carousel.getByRole("article").first().boundingBox())!;
    expect(firstCardBox.width / carouselBox.width).toBeGreaterThan(0.7);
    await page.getByRole("button", { name: "Next route" }).click();
    await expect(carousel.getByRole("article").nth(1)).toHaveAttribute(
      "data-selected",
      "true",
    );
    await testInfo.attach("kyoto-mobile", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  });

  test("Kyoto regional terrain keeps the approved tablet composition", async ({
    page,
  }, testInfo) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 834, height: 1112 });
    await page.goto(`${previewUrl}/#/atlas?region=Kyoto%2C+Japan`);

    const world = page.locator('div[data-atlas-engine="cesium"]');
    await expect(world).toHaveAttribute("data-atlas-status", "region-ready", {
      timeout: 60_000,
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      834,
    );
    const carousel = page.getByRole("region", {
      name: "Kyoto, Japan recorded routes",
      exact: true,
    });
    await expect(carousel).toBeVisible();
    const carouselBox = (await carousel.boundingBox())!;
    expect(carouselBox.x).toBeGreaterThanOrEqual(0);
    expect(carouselBox.x + carouselBox.width).toBeLessThanOrEqual(834);
    await testInfo.attach("kyoto-tablet", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  });

  test("visible Kyoto cards load real static satellite thumbnails", async ({
    page,
  }, testInfo) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${previewUrl}/#/atlas?region=Kyoto%2C+Japan`);

    const world = page.locator('div[data-atlas-engine="cesium"]');
    await expect(world).toHaveAttribute("data-atlas-status", "region-ready", {
      timeout: 60_000,
    });
    const carousel = page.getByRole("region", {
      name: "Kyoto, Japan recorded routes",
      exact: true,
    });
    const thumbnail = carousel.locator("[data-route-thumbnail]").first();
    await expect(thumbnail).toHaveAttribute("data-thumbnail-state", "loaded", {
      timeout: 30_000,
    });
    expect(
      await thumbnail.locator("img").evaluate((image) =>
        image instanceof HTMLImageElement ? image.naturalWidth : 0,
      ),
    ).toBeGreaterThan(0);
    await testInfo.attach("kyoto-static-thumbnail", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  });
});

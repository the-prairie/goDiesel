import { expect, test } from "@playwright/test";
import { PNG } from "pngjs";

const previewUrl = process.env.GODIESEL_ATLAS_PREVIEW_URL;

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

test.describe("live regional Atlas terrain", () => {
  test.skip(!previewUrl, "Set GODIESEL_ATLAS_PREVIEW_URL to a Pages preview.");

  for (const scenario of [
    { name: "Kyoto, Japan", maximumRangeM: 40_000 },
    { name: "Banff/Kananaskis", maximumRangeM: 200_000 },
  ]) {
    test(`${scenario.name} enters source-backed 3D terrain`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.addInitScript(() => {
        window.__GODIESEL_ATLAS_WORLD_ENGINE__ = "cesium";
      });
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
      await expectNonblankCanvas(canvas);
      await testInfo.attach(scenario.name.toLowerCase().replaceAll(/[^a-z]+/g, "-"), {
        body: await page.screenshot(),
        contentType: "image/png",
      });
    });
  }

  test("Kyoto regional terrain remains framed on mobile", async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      window.__GODIESEL_ATLAS_WORLD_ENGINE__ = "cesium";
    });
    await page.goto(`${previewUrl}/#/atlas?region=Kyoto%2C+Japan`);

    const world = page.locator('div[data-atlas-engine="cesium"]');
    await expect(world).toHaveAttribute("data-atlas-status", "region-ready", {
      timeout: 60_000,
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    await testInfo.attach("kyoto-mobile", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  });
});

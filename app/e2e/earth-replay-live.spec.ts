import { expect, test, type Locator } from "@playwright/test";
import { PNG } from "pngjs";

const liveEarthEnabled = process.env.GODIESEL_LIVE_EARTH_E2E === "1";
const kyotoRouteSlug = "17654151284";
const longestRouteSlug = "9845102380";

async function expectActualClearance(world: Locator, timeout = 15_000) {
  await expect
    .poll(
      async () => {
        const value = await world.getAttribute("data-camera-clearance-m");
        return value !== null && value !== "" && Number.isFinite(Number(value));
      },
      { timeout },
    )
    .toBe(true);
  const [clearanceM, minimumClearanceM] = await Promise.all([
    world.getAttribute("data-camera-clearance-m"),
    world.getAttribute("data-minimum-camera-clearance-m"),
  ]);
  expect(Number(clearanceM)).toBeGreaterThanOrEqual(Number(minimumClearanceM));
}

test.describe("live Earth Replay terrain clearance", () => {
  test.skip(
    !liveEarthEnabled,
    "Set GODIESEL_LIVE_EARTH_E2E=1 to exercise live Google 3D tiles.",
  );

  test("Kyoto scrubbing and every speed stay above photogrammetry", async ({
    page,
  }, testInfo) => {
    test.setTimeout(600_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/#/replay/${kyotoRouteSlug}`);

    const stage = page.getByTestId("replay-stage");
    const world = page.getByLabel("Earth Replay world");
    const progress = page.getByLabel("Route progress");
    await expect(stage).toHaveAttribute("data-state", /ready|partial/, {
      timeout: 60_000,
    });

    const maxProgressM = Number(await progress.getAttribute("max"));
    for (const [index, speed] of [1, 2, 4, 0.5].entries()) {
      if (index > 0) {
        await page.getByRole("button", { name: /Playback speed/ }).click();
      }
      await expect(stage).toHaveAttribute("data-speed", String(speed));
      for (const fraction of [0.05, 0.33, 0.66, 0.9]) {
        await progress.fill(String(maxProgressM * fraction));
        await expectActualClearance(world);
        if (index === 0 && fraction === 0.33) {
          await testInfo.attach("kyoto-steep-section", {
            body: await page.screenshot(),
            contentType: "image/png",
          });
        }
      }
      await progress.fill(String(maxProgressM - 5));
      await page.getByRole("button", { name: "Play route" }).click();
      await expect(page.getByRole("button", { name: "Play route" })).toBeVisible({
        timeout: 10_000,
      });
      expect(Number(await stage.getAttribute("data-progress"))).toBeGreaterThanOrEqual(
        maxProgressM - 25,
      );
      await expectActualClearance(world);
    }

    await progress.fill(String(maxProgressM * 0.4));
    await page.getByRole("button", { name: "Zoom out from route" }).click();
    await expect(stage).toHaveAttribute("data-camera-range", "720");
    await expectActualClearance(world);

    const screenshot = await world.screenshot();
    const png = PNG.sync.read(screenshot);
    let visiblePixelCount = 0;
    for (let pixel = 0; pixel < png.width * png.height; pixel += 144) {
      const offset = pixel * 4;
      if (
        png.data[offset] + png.data[offset + 1] + png.data[offset + 2] > 30 &&
        png.data[offset + 3] > 0
      ) {
        visiblePixelCount += 1;
      }
    }
    expect(visiblePixelCount).toBeGreaterThan(2_000);
  });

  test("longest route advances safely during sustained 4x playback", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/#/replay/${longestRouteSlug}`);

    const stage = page.getByTestId("replay-stage");
    const world = page.getByLabel("Earth Replay world");
    await expect(stage).toHaveAttribute("data-state", /ready|partial/, {
      timeout: 60_000,
    });
    await expectActualClearance(world);
    const initialPosition = await Promise.all([
      world.getAttribute("data-camera-latitude"),
      world.getAttribute("data-camera-longitude"),
    ]);

    await page.getByRole("button", { name: /Playback speed/ }).click();
    await page.getByRole("button", { name: /Playback speed/ }).click();
    await expect(stage).toHaveAttribute("data-speed", "4");
    await page.getByRole("button", { name: "Play route" }).click();
    for (let sample = 0; sample < 8; sample += 1) {
      await page.waitForTimeout(1_000);
      await expectActualClearance(world);
    }
    await page.getByRole("button", { name: "Pause route" }).click();

    expect(Number(await stage.getAttribute("data-progress"))).toBeGreaterThan(20_000);
    const finalPosition = await Promise.all([
      world.getAttribute("data-camera-latitude"),
      world.getAttribute("data-camera-longitude"),
    ]);
    expect(
      Math.hypot(
        Number(finalPosition[0]) - Number(initialPosition[0]),
        Number(finalPosition[1]) - Number(initialPosition[1]),
      ),
    ).toBeGreaterThan(0.001);
  });

  test("Kyoto Earth Replay remains framed on mobile", async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/#/replay/${kyotoRouteSlug}`);
    const stage = page.getByTestId("replay-stage");
    await expect(stage).toHaveAttribute("data-state", /ready|partial/, {
      timeout: 60_000,
    });
    await page.getByLabel("Route progress").fill("8500");
    await expectActualClearance(page.getByLabel("Earth Replay world"));

    await testInfo.attach("kyoto-mobile", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
  });
});

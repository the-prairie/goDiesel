import { expect, test } from "@playwright/test";
import { PNG } from "pngjs";

const liveEarthEnabled = process.env.GODIESEL_LIVE_EARTH_E2E === "1";
const kyotoRouteSlug = "17654151284";

test.describe("live Earth Replay terrain clearance", () => {
  test.skip(
    !liveEarthEnabled,
    "Set GODIESEL_LIVE_EARTH_E2E=1 to exercise live Google 3D tiles.",
  );

  test("Kyoto scrubbing and every speed stay above photogrammetry", async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/#/replay/${kyotoRouteSlug}`);

    const stage = page.getByTestId("replay-stage");
    const world = page.getByLabel("Earth Replay world");
    const progress = page.getByLabel("Route progress");
    await expect(stage).toHaveAttribute("data-state", /ready|partial/, {
      timeout: 60_000,
    });

    for (const progressM of [7_000, 8_500, 9_500, 12_000]) {
      await progress.fill(String(progressM));
      await expect
        .poll(
          () => world.getAttribute("data-camera-clearance-m"),
          { timeout: 15_000 },
        )
        .not.toBe("unknown");
      const [clearanceM, minimumClearanceM] = await Promise.all([
        world.getAttribute("data-camera-clearance-m"),
        world.getAttribute("data-minimum-camera-clearance-m"),
      ]);
      expect(Number(clearanceM)).toBeGreaterThanOrEqual(Number(minimumClearanceM));

      if (progressM === 8_500) {
        await testInfo.attach("kyoto-steep-section", {
          body: await page.screenshot(),
          contentType: "image/png",
        });
      }
    }

    for (const [index, speed] of [1, 2, 4, 0.5].entries()) {
      if (index > 0) {
        await page.getByRole("button", { name: /Playback speed/ }).click();
      }
      await expect(stage).toHaveAttribute("data-speed", String(speed));
      const maxProgressM = Number(await progress.getAttribute("max"));
      await progress.fill(String(maxProgressM - 5));
      await page.getByRole("button", { name: "Play route" }).click();
      await expect(page.getByRole("button", { name: "Play route" })).toBeVisible({
        timeout: 10_000,
      });
      expect(Number(await stage.getAttribute("data-progress"))).toBeGreaterThanOrEqual(
        maxProgressM - 25,
      );
    }

    const screenshot = await page.screenshot();
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

  test("Kyoto Earth Replay remains framed on mobile", async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/#/replay/${kyotoRouteSlug}`);
    const stage = page.getByTestId("replay-stage");
    await expect(stage).toHaveAttribute("data-state", /ready|partial/, {
      timeout: 60_000,
    });
    await page.getByLabel("Route progress").fill("8500");
    await expect
      .poll(
        () =>
          page
            .getByLabel("Earth Replay world")
            .getAttribute("data-camera-clearance-m"),
        { timeout: 15_000 },
      )
      .not.toBe("unknown");

    await testInfo.attach("kyoto-mobile", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
  });
});

import { expect, test } from "@playwright/test";
import { PNG } from "pngjs";

const ROUTES = [
  { slug: "14736711660", label: "San Francisco" },
  { slug: "14023448720", label: "Crete" },
] as const;

async function measureOpeningCameraMotion(page: import("@playwright/test").Page) {
  return page.locator("gmp-map-3d").evaluate(async (element) => {
    const samples: Array<{
      heading: number;
      lat: number;
      lng: number;
    }> = [];
    for (let index = 0; index < 24; index += 1) {
      const [lat, lng] = (element.getAttribute("center") ?? "0,0")
        .split(",")
        .map(Number);
      samples.push({
        heading: Number(element.getAttribute("heading") ?? 0),
        lat,
        lng,
      });
      await new Promise((resolve) => setTimeout(resolve, 65));
    }
    return samples.slice(1).reduce(
      (motion, sample, index) => {
        const previous = samples[index];
        const headingDelta = Math.abs(
          ((sample.heading - previous.heading + 540) % 360) - 180,
        );
        const northM = (sample.lat - previous.lat) * 111_320;
        const eastM =
          (sample.lng - previous.lng) *
          111_320 *
          Math.cos((sample.lat * Math.PI) / 180);
        return {
          maxHeadingDelta: Math.max(motion.maxHeadingDelta, headingDelta),
          maxTargetStepM: Math.max(
            motion.maxTargetStepM,
            Math.hypot(northM, eastM),
          ),
        };
      },
      { maxHeadingDelta: 0, maxTargetStepM: 0 },
    );
  });
}

function visualDetail(image: Buffer) {
  const png = PNG.sync.read(image);
  const colors = new Set<string>();
  const luminance: number[] = [];
  const stride = Math.max(8, Math.floor(Math.min(png.width, png.height) / 45));
  for (let y = 0; y < png.height; y += stride) {
    for (let x = 0; x < png.width; x += stride) {
      const index = (y * png.width + x) * 4;
      const red = png.data[index];
      const green = png.data[index + 1];
      const blue = png.data[index + 2];
      colors.add(`${red >> 4}:${green >> 4}:${blue >> 4}`);
      luminance.push(red * 0.2126 + green * 0.7152 + blue * 0.0722);
    }
  }
  const mean =
    luminance.reduce((total, value) => total + value, 0) / luminance.length;
  const variance =
    luminance.reduce((total, value) => total + (value - mean) ** 2, 0) /
    luminance.length;
  return { colorBins: colors.size, luminanceVariance: variance };
}

for (const route of ROUTES) {
  test(`directs ${route.label} through the live photorealistic world`, async ({
    page,
  }, testInfo) => {
    test.skip(
      process.env.GODIESEL_LIVE_GOOGLE_3D_E2E !== "1",
      "Live Google 3D verification is opt-in.",
    );

    await page.goto(`/#/lab/cinematic-director/${route.slug}`);
    const director = page.getByTestId("cinematic-director");
    await expect(director).toHaveAttribute("data-state", "ready", {
      timeout: 30_000,
    });
    await expect(page.locator("gmp-map-3d")).toBeVisible();
    await expect(page.locator("gmp-polyline-3d")).toHaveCount(1);
    await expect(page.getByTestId("cinematic-preroll")).toBeVisible();
    await expect(director).toHaveAttribute("data-cut", "feature");
    await expect(
      page.getByRole("button", { name: "Play Route Film" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Play Route Film" }).click();
    await expect(page.getByTestId("cinematic-chapter")).toBeVisible();
    await expect(director).toHaveAttribute("data-shot-kind", "establishing");
    await expect(director).toHaveAttribute(
      "data-terrain-character",
      /mountain|rolling|open/,
    );
    await expect(director).toHaveAttribute(
      "data-light-phase",
      /neutral|dawn|midday|dusk|night/,
    );
    const visual = await director.screenshot();
    const detail = visualDetail(visual);
    expect(detail.colorBins).toBeGreaterThan(40);
    expect(detail.luminanceVariance).toBeGreaterThan(120);
    await testInfo.attach(`${route.label}-cinematic-opening`, {
      body: visual,
      contentType: "image/png",
    });
    await expect(page.locator("gmp-polyline-3d")).toHaveAttribute(
      "data-route-visible",
      "false",
    );
    const cameraMotion = await measureOpeningCameraMotion(page);
    expect(cameraMotion.maxHeadingDelta).toBeLessThan(6);
    expect(cameraMotion.maxTargetStepM).toBeLessThan(100);

    const progress = page.getByTestId("cinematic-progress");
    await expect
      .poll(async () => Number(await progress.inputValue()))
      .toBeGreaterThan(0.01);

    await progress.focus();
    await page.keyboard.press("End");
    await expect(page.getByTestId("cinematic-decision")).toBeVisible();
    await expect(director).toHaveAttribute("data-shot-kind", "release");
    await expect(page.locator("gmp-polyline-3d")).toHaveAttribute(
      "data-route-visible",
      "true",
    );
    await expect(
      page.getByRole("link", { name: "Enter the route" }),
    ).toHaveAttribute("href", `#/lab/google-route-navigator/${route.slug}`);

    const routeColor = await page.locator("gmp-polyline-3d").evaluate((element) => {
      return (element as HTMLElement & { strokeColor?: string }).strokeColor;
    });
    expect(routeColor?.toLowerCase()).toBe("#f16c4b");
  });
}

test("keeps the Crete director decision usable on a phone", async ({ page }) => {
  test.skip(
    process.env.GODIESEL_LIVE_GOOGLE_3D_E2E !== "1",
    "Live Google 3D verification is opt-in.",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/lab/cinematic-director/14023448720");

  const director = page.getByTestId("cinematic-director");
  await expect(director).toHaveAttribute("data-state", "ready", {
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Play Route Film" }).click();
  const progress = page.getByTestId("cinematic-progress");
  await progress.focus();
  await page.keyboard.press("End");

  const decision = page.getByTestId("cinematic-decision");
  await expect(decision).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Enter the route" }),
  ).toBeVisible();
  const box = await decision.boundingBox();
  expect(box).not.toBeNull();
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(844);
});

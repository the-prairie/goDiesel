import { expect, test, type Locator } from "@playwright/test";
import { PNG } from "pngjs";

test.setTimeout(120_000);

const localOrigin = "http://127.0.0.1:8791";
const referenceRoutes = [
  { slug: "17665674778", worldId: "tokyo-urban" },
  { slug: "15573295095", worldId: "banff-mountain" },
  { slug: "6496900063", worldId: "ucluelet-coastal" },
] as const;

async function expectNonblankWorld(canvas: Locator) {
  const screenshot = PNG.sync.read(await canvas.screenshot());
  const colors = new Set<string>();
  let routePixels = 0;
  for (let index = 0; index < screenshot.data.length; index += 4) {
    const red = screenshot.data[index];
    const green = screenshot.data[index + 1];
    const blue = screenshot.data[index + 2];
    if (index % 256 === 0) colors.add(`${red},${green},${blue}`);
    if (blue > 120 && blue - red > 35) routePixels += 1;
  }
  expect(colors.size).toBeGreaterThan(12);
  expect(routePixels).toBeGreaterThan(8);
}

test("all reference worlds open from verified local media with providers blocked", async ({
  page,
}) => {
  const externalRequests: string[] = [];
  const structureTileRequests = new Map<string, number>();
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith(".b3dm")) {
      structureTileRequests.set(
        url.pathname,
        (structureTileRequests.get(url.pathname) ?? 0) + 1,
      );
    }
  });
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === localOrigin) {
      await route.continue();
      return;
    }
    externalRequests.push(url.href);
    await route.abort("blockedbyclient");
  });

  for (const reference of referenceRoutes) {
    await page.goto(`/#/lab/playable-earth/${reference.slug}`);
    const lab = page.getByRole("region", { name: "Playable Earth Lab" });
    await expect(lab).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
    const canvas = page.locator('canvas[aria-label="Verified local World Pack"]');
    await expect(canvas).toHaveCount(1);
    await expect(canvas).toHaveAttribute("data-world-id", reference.worldId);
    await expect(canvas).toHaveAttribute("data-world-pack-state", "ready");
    await expect(canvas).toHaveAttribute("data-network-required", "false");
    await expect(canvas).toHaveAttribute(
      "data-physical-neighbourhood",
      "verified",
    );
    await expectNonblankWorld(canvas);
    if (reference.worldId === "tokyo-urban") {
      expect(
        [...structureTileRequests.values()].filter((requestCount) => requestCount >= 2)
          .length,
      ).toBeGreaterThan(0);
    }
  }

  expect(externalRequests).toEqual([]);
});

test("physical free roam, cameras, ghost, checkpoint, and rejoin share one local world", async ({
  page,
}) => {
  const externalRequests: string[] = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === localOrigin) {
      await route.continue();
      return;
    }
    externalRequests.push(url.href);
    await route.abort("blockedbyclient");
  });
  await page.goto("/#/lab/playable-earth/17665674778");
  const lab = page.getByRole("region", { name: "Playable Earth Lab" });
  const canvas = page.locator('canvas[aria-label="Verified local World Pack"]');
  await expect(lab).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await expect(lab).toHaveAttribute("data-physical-ready", "true");
  await expect(canvas).toHaveCount(1);

  const initialPosition = await lab.evaluate((element) => ({
    x: Number(element.getAttribute("data-player-x")),
    y: Number(element.getAttribute("data-player-y")),
  }));
  await page.getByRole("button", { name: "Enter free roam" }).click();
  await expect(lab).toHaveAttribute("data-control-mode", "free-roam");
  await page.keyboard.down("w");
  await page.waitForTimeout(1_200);
  await page.keyboard.up("w");
  await expect
    .poll(async () => Number(await lab.getAttribute("data-simulation-tick")))
    .toBeGreaterThan(30);
  const movedPosition = await lab.evaluate((element) => ({
    x: Number(element.getAttribute("data-player-x")),
    y: Number(element.getAttribute("data-player-y")),
    z: Number(element.getAttribute("data-player-z")),
  }));
  expect(Math.hypot(movedPosition.x - initialPosition.x, movedPosition.y - initialPosition.y))
    .toBeGreaterThan(2);
  expect(Number.isFinite(movedPosition.z)).toBe(true);

  await page.getByRole("button", { name: "Show route ghost" }).click();
  await expect(lab).toHaveAttribute("data-ghost-visible", "true");
  await expect(canvas).toHaveAttribute("data-ghost-visible", "true");

  await page.getByRole("button", { name: "Camera mode route follow" }).click();
  await expect(lab).toHaveAttribute("data-camera-mode", "chase");
  await expect(canvas).toHaveAttribute("data-camera-mode", "chase");
  await page.getByRole("button", { name: "Camera mode chase" }).click();
  await expect(lab).toHaveAttribute("data-camera-mode", "first-person");
  await expect(canvas).toHaveAttribute("data-camera-mode", "first-person");

  await page.getByRole("button", { name: "Return to checkpoint" }).click();
  await expect(lab).toHaveAttribute("data-recovery-count", "1");
  await page.getByRole("button", { name: "Rejoin route" }).click();
  await expect(lab).toHaveAttribute("data-control-mode", "guided");
  await page.getByRole("button", { name: "Resume automatic replay" }).click();
  await expect(lab).toHaveAttribute("data-control-mode", "replay");
  await expect(canvas).toHaveCount(1);
  expect(externalRequests).toEqual([]);
});

test("mobile physical controls preserve a usable world viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === localOrigin) await route.continue();
    else await route.abort("blockedbyclient");
  });
  await page.goto("/#/lab/playable-earth/17665674778");
  const lab = page.getByRole("region", { name: "Playable Earth Lab" });
  await expect(lab).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  await page.getByRole("button", { name: "Show more controls" }).click();
  await page.getByRole("button", { name: "Enter free roam" }).click();
  await expect(lab).toHaveAttribute("data-control-mode", "free-roam");

  for (const label of [
    "Move forward",
    "Move backward",
    "Strafe left",
    "Strafe right",
    "Turn left",
    "Turn right",
    "Rejoin route",
    "Return to checkpoint",
    "Camera mode route follow",
    "Show route ghost",
  ]) {
    const button = page.getByRole("button", { name: label });
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  const contextBox = await page.getByTestId("playable-context").boundingBox();
  const controlsBox = await page.getByTestId("playable-controls").boundingBox();
  expect((controlsBox?.y ?? 0) - ((contextBox?.y ?? 0) + (contextBox?.height ?? 0)))
    .toBeGreaterThan(180);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    320,
  );
});

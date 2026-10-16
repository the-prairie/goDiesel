import { expect, test, type Route } from "@playwright/test";
import { PNG } from "pngjs";

import { installDeterministicCesiumAtlas } from "./helpers/deterministic-atlas";

for (const { width, height } of [{ width: 390, height: 900 }, { width: 1440, height: 900 }, { width: 844, height: 390 }]) {
  test(`regional fallback recovers after its deadline and reconciles history at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    let pendingStyle: Route | undefined;
    await page.route("**/styles/liberty", route => { pendingStyle = route; });
    await page.addInitScript(() => { window.__GODIESEL_ATLAS_REGION_OUTCOME__ = "fallback"; });
    await installDeterministicCesiumAtlas(page);
    await page.goto("/#/atlas?region=Kyoto%2C+Japan");
    const fallback = page.locator('[data-atlas-engine="maplibre-regional-fallback"]');
    await expect(fallback).toHaveAttribute("data-map-status", "loading");
    await expect.poll(() => Boolean(pendingStyle)).toBe(true);
    await page.clock.install();
    await page.clock.fastForward(10_001);
    await expect(fallback).toHaveAttribute("data-map-status", "unavailable");
    await expect(page.getByText("Regional map unavailable.", { exact: true })).toBeVisible();
    await pendingStyle!.fulfill({ json: {
      version: 8, sources: {},
      layers: [{ id: "background", type: "background", paint: { "background-color": "#d9ddd2" } }],
    } });
    await expect(fallback).toHaveAttribute("data-map-status", "ready");
    await expect(page.getByText("3D terrain partially unavailable.", { exact: true })).toBeVisible();
    const carousel = page.getByRole("region", { name: "Kyoto, Japan recorded routes", exact: true });
    await expect(carousel).toBeVisible();
    const mapHost = fallback.getByRole("img", { name: "Kyoto, Japan regional route map", exact: true });
    const hostBounds = (await mapHost.boundingBox())!;
    expect(hostBounds.height).toBeGreaterThan(height / 2);
    expect(hostBounds.y + hostBounds.height).toBeLessThanOrEqual(height);
    const notice = fallback.getByRole("status");
    const noticeBounds = (await notice.boundingBox())!;
    const trayBounds = (await page.getByRole("region", { name: "Kyoto, Japan routes", exact: true }).boundingBox())!;
    expect(noticeBounds.y + noticeBounds.height).toBeLessThanOrEqual(trayBounds.y);
    const routePath = fallback.locator("path[data-route-hit-target]").first();
    for (const path of await fallback.locator("path[data-route-hit-target]").all()) {
      const bounds = (await path.boundingBox())!;
      expect(bounds.y + bounds.height).toBeLessThan(trayBounds.y);
    }
    const initialPath = await routePath.getAttribute("d");
    const controls = page.getByRole("group", { name: "Map controls" });
    await controls.getByRole("button", { name: "Zoom in", exact: true }).click();
    await page.clock.runFor(1000);
    await expect(routePath).not.toHaveAttribute("d", initialPath!);
    const zoomedPath = await routePath.getAttribute("d");
    await controls.getByRole("button", { name: "Zoom out", exact: true }).click();
    await page.clock.runFor(1000);
    await expect(routePath).not.toHaveAttribute("d", zoomedPath!);
    await controls.getByRole("button", { name: "Zoom in", exact: true }).click();
    await page.clock.runFor(1000);
    await controls.getByRole("button", { name: "Reset globe view", exact: true }).click();
    await expect(routePath).toHaveAttribute("d", initialPath!);
    const cards = carousel.locator("article[data-route-slug]");
    await page.getByRole("button", { name: "Next route", exact: true }).click();
    await expect(cards.nth(1)).toHaveAttribute("data-selected", "true");
    await page.goBack();
    await expect(carousel).toBeVisible();
    await expect(cards.first()).toHaveAttribute("data-selected", "true");
    await page.clock.fastForward(10_001);
    await expect(fallback).toHaveAttribute("data-map-status", "ready");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `artifacts/state-migration/t04/fallback-${width}.png` });
  });
}

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`production Cesium Atlas renders and selects places on ${viewport.name}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await installDeterministicCesiumAtlas(page);
    await page.goto("/#/atlas");

    const world = page.locator('[data-atlas-engine="cesium"][data-atlas-status]');
    const canvas = page.getByLabel("Interactive route globe");
    await expect(world).toHaveAttribute("data-atlas-status", "ready");
    await expect(canvas).toHaveAttribute("data-heat-lines", "66");
    const nonBackgroundPixels = await canvas.evaluate((element) => {
      const canvas = element as HTMLCanvasElement;
      const pixels = canvas
        .getContext("2d")!
        .getImageData(0, 0, canvas.width, canvas.height).data;
      let bright = 0;
      for (let index = 0; index < pixels.length; index += 64) {
        if (pixels[index] + pixels[index + 1] + pixels[index + 2] > 180) bright += 1;
      }
      return bright;
    });
    expect(nonBackgroundPixels).toBeGreaterThan(100);

    const place = page.locator("button[data-globe-region]:visible").first();
    const region = await place.getAttribute("data-globe-region");
    await place.click();
    await expect
      .poll(() => new URLSearchParams(new URL(page.url()).hash.split("?")[1]).get("region"))
      .toBe(region);
    await expect(
      page.getByRole("heading", { level: 2, name: region! }),
    ).toBeVisible();
    await expect(canvas).toHaveAttribute("data-camera-region", region!);
    await expect(world).toHaveAttribute("data-atlas-status", "region-ready");
    await expect(canvas).toHaveAttribute("data-camera-target", "28000");
    await expect(canvas).toHaveAttribute("data-terrain-state", "ready");

    await canvas.focus();
    await page.keyboard.press("ArrowRight");
    await expect(canvas).toHaveAttribute("data-camera-target", "28010");

    const beforeZoom = Number(await canvas.getAttribute("data-camera-target"));
    await page.getByRole("button", { name: "Zoom in" }).click();
    await expect
      .poll(async () => Number(await canvas.getAttribute("data-camera-target")))
      .toBeLessThan(beforeZoom);
  });
}

test("Cesium failure remains legible without restoring the obsolete world", async ({ page }) => {
  await page.addInitScript(() => {
    window.__GODIESEL_ATLAS_WORLD_DESTROY_COUNT__ = 0;
    window.__GODIESEL_ATLAS_WORLD_FACTORY__ = () => ({
      async mount({ onStatus }) {
        onStatus({ state: "unavailable", message: "Synthetic provider failure." });
      },
      setSelectedRegion() {},
      setSelectedRoute() {},
      projectRegions: () => [],
      zoomIn() {},
      zoomOut() {},
      resetView() {},
      destroy() {
        window.__GODIESEL_ATLAS_WORLD_DESTROY_COUNT__ += 1;
      },
    });
  });
  await page.goto("/#/atlas?region=Kyoto%2C+Japan");

  await expect(page.locator('[data-atlas-engine="cesium"]')).toHaveAttribute(
    "data-atlas-status",
    "unavailable",
  );
  await expect(page.locator('[data-atlas-engine^="three"]')).toHaveCount(0);
  await expect(
    page.getByText("Synthetic provider failure. Search and navigation remain available."),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Kyoto, Japan" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/region=Kyoto%2C\+Japan/);
  await expect
    .poll(() => page.evaluate(() => window.__GODIESEL_ATLAS_WORLD_DESTROY_COUNT__))
    .toBe(0);
  await page.goto("/#/routes");
  await expect
    .poll(() => page.evaluate(() => window.__GODIESEL_ATLAS_WORLD_DESTROY_COUNT__))
    .toBe(1);
});

test("Cesium enters a region selected by the initial URL", async ({ page }) => {
  await installDeterministicCesiumAtlas(page);
  await page.goto("/#/atlas?region=Kyoto%2C+Japan");

  const canvas = page.getByLabel("Interactive route globe");
  await expect(canvas).toHaveAttribute("data-camera-region", "Kyoto, Japan");
  await expect(canvas).toHaveAttribute("data-region-selection-count", "1");
  await expect(page.locator('div[data-atlas-engine="cesium"]')).toHaveAttribute(
    "data-atlas-status",
    "region-ready",
  );
  await expect(canvas).toHaveAttribute("data-camera-target", "28000");
  await expect(
    page.getByRole("heading", { level: 2, name: "Kyoto, Japan" }),
  ).toBeVisible();
});

test("search, keyboard, and wheel input share the Cesium camera target", async ({
  page,
}) => {
  await installDeterministicCesiumAtlas(page);
  await page.goto("/#/atlas");

  const canvas = page.getByLabel("Interactive route globe");
  const search = page.getByRole("textbox", {
    name: "Search places and routes",
  });
  await search.fill("kyoto");
  await page.getByRole("option", { name: "Kyoto, Japan", exact: true }).click();
  await expect(canvas).toHaveAttribute("data-camera-region", "Kyoto, Japan");
  await expect(page.locator('div[data-atlas-engine="cesium"]')).toHaveAttribute(
    "data-atlas-status",
    "region-ready",
  );
  await expect(canvas).toHaveAttribute("data-camera-target", "28000");

  await canvas.focus();
  await page.keyboard.press("ArrowRight");
  await expect(canvas).toHaveAttribute("data-camera-target", "28010");
  await canvas.dispatchEvent("wheel", { deltaY: 500 });
  await expect(canvas).toHaveAttribute("data-camera-target", "28510");
});

test("reduced motion settles regional terrain within 150 milliseconds", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installDeterministicCesiumAtlas(page);
  await page.goto("/#/atlas?region=Kyoto%2C+Japan");

  const canvas = page.getByLabel("Interactive route globe");
  await expect(canvas).toHaveAttribute("data-camera-duration-ms", "120");
  await expect(page.locator('div[data-atlas-engine="cesium"]')).toHaveAttribute(
    "data-atlas-status",
    "region-ready",
  );
});

test("regional terrain failure preserves URL state in a source-backed map", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__GODIESEL_ATLAS_REGION_OUTCOME__ = "fallback";
  });
  await page.route("**/styles/liberty", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        version: 8,
        sources: {},
        layers: [
          {
            id: "background",
            type: "background",
            paint: { "background-color": "#d9ddd2" },
          },
        ],
      }),
    });
  });
  await installDeterministicCesiumAtlas(page);
  await page.goto("/#/atlas?region=Kyoto%2C+Japan");

  const fallback = page.locator(
    '[data-atlas-engine="maplibre-regional-fallback"]',
  );
  await expect(fallback).toHaveAttribute("data-map-status", "ready");
  await expect(fallback).toHaveAttribute("data-region-route-count", "2");
  await expect(
    fallback.locator('[data-regional-route-overlay="true"] path:not([data-route-hit-target])'),
  ).toHaveCount(4);
  await expect(page).toHaveURL(/region=Kyoto%2C\+Japan/);
  await expect(page.getByText("3D terrain partially unavailable.")).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Kyoto, Japan" }),
  ).toBeVisible();
  const carousel = page.getByRole("region", {
    name: "Kyoto, Japan recorded routes",
  });
  const cards = carousel.locator("article[data-route-slug]");
  await expect(cards.first()).toHaveAttribute("data-selected", "true");
  await fallback.locator("path[data-route-hit-target]").nth(1).dispatchEvent("click");
  await expect(cards.nth(1)).toHaveAttribute("data-selected", "true");

  const screenshot = PNG.sync.read(await fallback.screenshot());
  const colors = new Set<string>();
  for (let index = 0; index < screenshot.data.length; index += 400) {
    colors.add(
      `${screenshot.data[index]},${screenshot.data[index + 1]},${screenshot.data[index + 2]}`,
    );
  }
  expect(colors.size).toBeGreaterThan(2);
});

test("Cesium releases its renderer when Atlas unmounts", async ({ page }) => {
  await installDeterministicCesiumAtlas(page);
  await page.goto("/#/atlas");
  await expect(page.getByLabel("Interactive route globe")).toBeVisible();

  await page
    .getByTestId("atlas-spine")
    .getByRole("link", { name: "Finder" })
    .click();
  await expect(page).toHaveURL(/#\/finder/);
  await expect
    .poll(() => page.evaluate(() => window.__GODIESEL_ATLAS_WORLD_DESTROY_COUNT__))
    .toBe(1);
});

test("regional carousel gates on terrain and keeps route selection synchronized", async ({
  page,
}) => {
  await installDeterministicCesiumAtlas(page);
  await page.goto("/#/atlas?region=Kyoto%2C+Japan");

  await expect(
    page
      .getByRole("region", { name: "Kyoto, Japan routes" })
      .getByText("Loading Kyoto, Japan terrain"),
  ).toBeVisible();
  await expect(
    page.getByRole("region", {
      name: "Kyoto, Japan recorded routes",
      exact: true,
    }),
  ).toHaveCount(0);
  const carousel = page.getByRole("region", {
    name: "Kyoto, Japan recorded routes",
  });
  await expect(
    page.locator('[data-atlas-engine="cesium"][data-atlas-status]'),
  ).toHaveAttribute(
    "data-atlas-status",
    "region-ready",
    { timeout: 15_000 },
  );
  await expect(carousel).toBeVisible();
  const cards = carousel.locator("article[data-route-slug]");
  await expect(cards).toHaveCount(2);

  const first = cards.nth(0);
  const second = cards.nth(1);
  const firstSlug = await first.getAttribute("data-route-slug");
  const secondSlug = await second.getAttribute("data-route-slug");
  await expect(first).toHaveAttribute("data-selected", "true");
  await expect(page).not.toHaveURL(/route=/);
  await expect(page.getByLabel("Interactive route globe")).toHaveAttribute(
    "data-selected-route",
    firstSlug!,
  );

  await page.getByRole("button", { name: "Next route" }).click();
  await expect(second).toHaveAttribute("data-selected", "true");
  await expect(page).toHaveURL(new RegExp(`route=${secondSlug}`));
  await expect(page.getByLabel("Interactive route globe")).toHaveAttribute(
    "data-selected-route",
    secondSlug!,
  );

  await carousel.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(first).toHaveAttribute("data-selected", "true");
  await page.getByLabel("Interactive route globe").dispatchEvent("dblclick");
  await expect(second).toHaveAttribute("data-selected", "true");
  await first.getByRole("button", { name: /Select / }).click();
  await expect(first).toHaveAttribute("data-selected", "true");
  await second.getByRole("button", { name: /Select / }).click();
  await expect(second).toHaveAttribute("data-selected", "true");

  await second.getByRole("link", { name: "Open replay" }).click();
  await expect(page).toHaveURL(new RegExp(`#/replay/${secondSlug}`));
  await page.goBack();
  await expect(page).toHaveURL(/#\/atlas\?region=Kyoto%2C\+Japan/);
  await expect(page).toHaveURL(new RegExp(`route=${secondSlug}`));
  await expect(second).toHaveAttribute("data-selected", "true");
});

test("carousel drag selects one route without moving the globe", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installDeterministicCesiumAtlas(page);
  await page.goto("/#/atlas?region=Crete%2C+Greece");

  const carousel = page.getByRole("region", {
    name: "Crete, Greece recorded routes",
  });
  const cards = carousel.locator("article[data-route-slug]");
  const first = cards.first();
  const second = cards.nth(1);
  await expect(first).toHaveAttribute("data-selected", "true");
  const canvas = page.getByLabel("Interactive route globe");
  const cameraTargetBeforeDrag = await canvas.getAttribute("data-camera-target");
  const carouselBox = (await carousel.boundingBox())!;
  await page.mouse.move(
    carouselBox.x + carouselBox.width * 0.78,
    carouselBox.y + carouselBox.height * 0.55,
  );
  await page.mouse.down();
  await page.mouse.move(
    carouselBox.x + carouselBox.width * 0.16,
    carouselBox.y + carouselBox.height * 0.55,
    { steps: 16 },
  );
  await page.mouse.up();

  await expect(second).toHaveAttribute("data-selected", "true");
  await expect(canvas).toHaveAttribute("data-camera-target", cameraTargetBeforeDrag!);
  await expect(page).toHaveURL(/route=/);
});

test("opening a non-selected card preserves its exact Atlas return selection", async ({
  page,
}) => {
  await installDeterministicCesiumAtlas(page);
  await page.goto("/#/atlas?region=Crete%2C+Greece");

  const carousel = page.getByRole("region", {
    name: "Crete, Greece recorded routes",
  });
  const target = carousel.locator("article[data-route-slug]").nth(2);
  const targetSlug = await target.getAttribute("data-route-slug");
  await expect(target).toHaveAttribute("data-selected", "false");
  await target.getByRole("link", { name: "Open replay" }).click();

  await expect(page).toHaveURL(new RegExp(`#/replay/${targetSlug}`));
  await page.getByRole("button", { name: "Back to Atlas" }).click();
  await expect(page).toHaveURL(/#\/atlas\?region=Crete%2C\+Greece/);
  await expect(page).toHaveURL(new RegExp(`route=${targetSlug}`));
  await expect(
    page
      .getByRole("region", {
        name: "Crete, Greece recorded routes",
        exact: true,
      })
      .locator(`article[data-route-slug="${targetSlug}"]`),
  ).toHaveAttribute("data-selected", "true");
});

test("route thumbnails load only for the centered route and immediate neighbors", async ({
  page,
}) => {
  const requestedPaths: string[] = [];
  const thumbnail = new PNG({ width: 8, height: 8 });
  thumbnail.data.fill(96);
  const thumbnailBody = PNG.sync.write(thumbnail);
  await page.addInitScript(() => {
    window.__GODIESEL_STATIC_MAPS_API_KEY__ = "deterministic-test-key";
  });
  await page.route("https://maps.googleapis.com/maps/api/staticmap?*", async (route) => {
    requestedPaths.push(new URL(route.request().url()).searchParams.get("path") ?? "");
    await route.fulfill({
      status: 200,
      contentType: "image/png",
      body: thumbnailBody,
    });
  });
  await installDeterministicCesiumAtlas(page);
  await page.goto("/#/atlas?region=Crete%2C+Greece");

  const carousel = page.getByRole("region", {
    name: "Crete, Greece recorded routes",
  });
  const thumbnails = carousel.locator("[data-route-thumbnail]");
  await expect(thumbnails.nth(0)).toHaveAttribute("data-thumbnail-state", "loaded");
  await expect(thumbnails.nth(1)).toHaveAttribute("data-thumbnail-state", "loaded");
  await expect(thumbnails.nth(2)).toHaveAttribute("data-thumbnail-state", "loaded");
  await expect(thumbnails.nth(3)).toHaveAttribute("data-thumbnail-state", "loaded");
  await expect(thumbnails.nth(4)).toHaveAttribute("data-thumbnail-state", "deferred");
  expect(requestedPaths).toHaveLength(4);
  expect(requestedPaths.every((path) => path.split("|").slice(2).length <= 36)).toBe(
    true,
  );

  await page.getByRole("button", { name: "Next route" }).click();
  await expect(thumbnails.nth(4)).toHaveAttribute("data-thumbnail-state", "loaded");
  expect(requestedPaths).toHaveLength(5);
  await expect(carousel.locator("canvas")).toHaveCount(0);
});

test("failed satellite imagery preserves route traces and honest draft context", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__GODIESEL_STATIC_MAPS_API_KEY__ = "deterministic-test-key";
  });
  await page.route("https://maps.googleapis.com/maps/api/staticmap?*", (route) =>
    route.fulfill({ status: 503, body: "imagery unavailable" }),
  );
  await installDeterministicCesiumAtlas(page);
  await page.goto("/#/atlas?region=Kyoto%2C+Japan");

  const carousel = page.getByRole("region", {
    name: "Kyoto, Japan recorded routes",
  });
  const secondCard = carousel.locator("article[data-route-slug]").nth(1);
  const heightBefore = (await secondCard.boundingBox())!.height;
  await expect(
    secondCard.locator("[data-route-thumbnail]"),
  ).toHaveAttribute("data-thumbnail-state", "failed");
  await expect(secondCard.getByText("Guide not yet reviewed")).toBeVisible();
  await expect(
    secondCard.getByRole("img", { name: /recorded route trace/ }),
  ).toBeVisible();
  expect((await secondCard.boundingBox())!.height).toBe(heightBefore);
});

for (const viewport of [
  { name: "desktop", width: 1440, height: 900, minimumRatio: 0.28, maximumRatio: 0.36, fullCards: 3, hasPeek: false },
  { name: "tablet", width: 820, height: 900, minimumRatio: 0.4, maximumRatio: 0.5, fullCards: 2, hasPeek: true },
  { name: "mobile", width: 390, height: 844, minimumRatio: 0.78, maximumRatio: 0.9, fullCards: 1, hasPeek: true },
]) {
  test(`regional carousel exposes the intended ${viewport.name} card rhythm`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await installDeterministicCesiumAtlas(page);
    await page.goto("/#/atlas?region=Crete%2C+Greece");

    const carousel = page.getByRole("region", {
      name: "Crete, Greece recorded routes",
    });
    await expect(carousel).toBeVisible();
    await page.getByRole("button", { name: "Next route" }).click();
    await page.getByRole("button", { name: "Next route" }).click();
    const card = carousel.locator("article[data-route-slug]").first();
    const [carouselBox, cardBox] = await Promise.all([
      carousel.boundingBox(),
      card.boundingBox(),
    ]);
    expect(carouselBox).not.toBeNull();
    expect(cardBox).not.toBeNull();
    const ratio = cardBox!.width / carouselBox!.width;
    expect(ratio).toBeGreaterThan(viewport.minimumRatio);
    expect(ratio).toBeLessThan(viewport.maximumRatio);
    const visibility = await carousel.locator("article[data-route-slug]").evaluateAll(
      (cards, viewportBounds) =>
        cards.map((card) => {
          const bounds = card.getBoundingClientRect();
          const visibleWidth = Math.max(
            0,
            Math.min(bounds.right, viewportBounds.right) -
              Math.max(bounds.left, viewportBounds.left),
          );
          return visibleWidth / bounds.width;
        }),
      {
        left: carouselBox!.x,
        right: carouselBox!.x + carouselBox!.width,
      },
    );
    expect(visibility.filter((visible) => visible >= 0.95)).toHaveLength(
      viewport.fullCards,
    );
    expect(
      visibility.some((visible) => visible > 0.05 && visible < 0.95),
    ).toBe(viewport.hasPeek);
    if (viewport.name === "tablet") {
      expect(visibility.reduce((total, visible) => total + visible, 0)).toBeGreaterThan(2);
    }
    const selectedCard = carousel.locator('article[data-selected="true"]');
    await expect(selectedCard).toBeInViewport();
    const selectedBox = (await selectedCard.boundingBox())!;
    expect(Math.abs(selectedBox.x - carouselBox!.x)).toBeLessThan(3);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(viewport.width);
  });
}

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 820, height: 900 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`one-route regions keep carousel dimensions with bounded navigation on ${viewport.name}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await installDeterministicCesiumAtlas(page);
    await page.goto("/#/atlas?region=London%2C+UK");

    const carousel = page.getByRole("region", {
      name: "London, UK recorded routes",
    });
    await expect(carousel.locator("article[data-route-slug]")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Previous route" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Next route" })).toBeDisabled();
    const height = (await carousel.boundingBox())!.height;
    expect(height).toBeGreaterThanOrEqual(132);
    expect(height).toBeLessThanOrEqual(148);
    await expect(carousel.getByRole("link", { name: "Route guide" })).toBeInViewport();
    await expect(carousel.getByRole("link", { name: "Open replay" })).toBeInViewport();
  });
}

declare global {
  interface Window {
    __GODIESEL_ATLAS_WORLD_DESTROY_COUNT__: number;
    __GODIESEL_ATLAS_REGION_OUTCOME__?: "ready" | "fallback";
  }
}

test("compact route strip keeps the selected route visible after a mobile resize", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await installDeterministicCesiumAtlas(page);
  await page.goto("/#/atlas?region=Kyoto%2C+Japan");
  await page.getByRole("button", { name: "Next route" }).click();
  const selected = page.locator('article[data-selected="true"]');
  await expect(selected).toContainText("32.6 km");
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 320 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(async () => {
      const box = await selected.boundingBox();
      return Boolean(box && box.x >= 0 && box.x + box.width <= viewport.width);
    }).toBe(true);
    await expect(selected.getByRole("link", { name: "Open replay" })).toBeInViewport();
    await expect(selected.getByRole("link", { name: "Route guide" })).toBeInViewport();
  }
});

test("reselecting the current ready region retains its carousel", async ({ page }) => {
  await installDeterministicCesiumAtlas(page);
  await page.goto("/#/atlas?region=Kyoto%2C+Japan");
  const carousel = page.getByRole("region", { name: "Kyoto, Japan recorded routes", exact: true });
  await expect(carousel).toBeVisible();
  await page.getByRole("textbox", { name: "Search places and routes" }).fill("Kyoto");
  await page.getByRole("option", { name: "Kyoto, Japan", exact: true }).click();
  await expect(page.locator('div[data-atlas-engine="cesium"]')).toHaveAttribute("data-atlas-status", "region-ready");
  await expect(carousel).toBeVisible({ timeout: 2000 });
});

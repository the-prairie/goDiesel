import { expect, test } from "@playwright/test";
import { PNG } from "pngjs";

async function installDeterministicCesiumAtlas(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    window.__GODIESEL_ATLAS_WORLD_DESTROY_COUNT__ = 0;
    window.__GODIESEL_ATLAS_WORLD_FACTORY__ = () => {
      let canvas: HTMLCanvasElement | undefined;
      let regions: Array<{ name: string }> = [];
      let selectedRegion: string | undefined;
      let cameraTarget = 18_500_000;
      let regionalTimer: number | undefined;
      let reportStatus: ((status: {
        state: "ready" | "region-loading" | "region-ready" | "region-fallback";
        message: string;
        regionName?: string;
      }) => void) | undefined;
      const syncCamera = () => {
        if (canvas) canvas.dataset.cameraTarget = String(cameraTarget);
      };
      return {
        async mount(options) {
          regions = options.regions;
          canvas = document.createElement("canvas");
          canvas.width = Math.max(640, options.container.clientWidth);
          canvas.height = Math.max(480, options.container.clientHeight);
          canvas.style.width = "100%";
          canvas.style.height = "100%";
          canvas.setAttribute("aria-label", "Interactive route globe");
          canvas.setAttribute(
            "aria-keyshortcuts",
            "ArrowLeft ArrowRight ArrowUp ArrowDown + -",
          );
          canvas.tabIndex = 0;
          canvas.dataset.atlasEngine = "cesium";
          canvas.dataset.heatLines = String(
            options.regions.reduce(
              (total, region) => total + region.routes.length,
              0,
            ),
          );
          canvas.dataset.routePalette = "cobalt";
          canvas.dataset.atlasState = "global";
          canvas.dataset.cameraState = "settled";
          canvas.dataset.terrainState = "global";
          canvas.dataset.regionRouteCount = "0";
          reportStatus = options.onStatus;
          syncCamera();
          const context = canvas.getContext("2d")!;
          context.fillStyle = "#07182b";
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.strokeStyle = "#62a7ff";
          context.lineWidth = 4;
          for (let index = 0; index < 66; index += 1) {
            context.beginPath();
            context.moveTo((index * 41) % canvas.width, (index * 29) % canvas.height);
            context.lineTo(
              ((index * 41) % canvas.width) + 90,
              ((index * 29) % canvas.height) + 35,
            );
            context.stroke();
          }
          canvas.addEventListener("wheel", (event) => {
            cameraTarget += event.deltaY;
            syncCamera();
          });
          canvas.addEventListener("keydown", (event) => {
            if (event.key === "ArrowRight") {
              cameraTarget += 10;
              syncCamera();
            }
          });
          canvas.addEventListener("dblclick", () => {
            const region = options.regions.find(
              (candidate) => candidate.name === selectedRegion,
            );
            const route = region?.routes.at(-1);
            if (route) options.onSelectRoute?.(route);
          });
          options.container.append(canvas);
          options.onStatus({ state: "ready", message: "Atlas world ready." });
        },
        setSelectedRegion(region) {
          selectedRegion = region?.name;
          if (canvas) {
            canvas.dataset.cameraRegion = selectedRegion ?? "";
            canvas.dataset.regionSelectionCount = String(
              Number(canvas.dataset.regionSelectionCount ?? "0") + 1,
            );
          }
          if (regionalTimer !== undefined) window.clearTimeout(regionalTimer);
          if (!region) {
            cameraTarget = 18_500_000;
            if (canvas) {
              canvas.dataset.atlasState = "global";
              canvas.dataset.cameraState = "settled";
              canvas.dataset.terrainState = "global";
              canvas.dataset.regionRouteCount = "0";
            }
            reportStatus?.({ state: "ready", message: "Atlas world ready." });
            syncCamera();
            return;
          }
          cameraTarget = region.name.includes("Banff") ? 42_000 : 28_000;
          const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? 120
            : 1_150;
          if (canvas) {
            canvas.dataset.atlasState = "region-loading";
            canvas.dataset.cameraState = "transitioning";
            canvas.dataset.terrainState = "loading";
            canvas.dataset.cameraDurationMs = String(duration);
            canvas.dataset.regionRouteCount = String(region.routes.length);
          }
          reportStatus?.({
            state: "region-loading",
            regionName: region.name,
            message: `Loading ${region.name} terrain`,
          });
          syncCamera();
          regionalTimer = window.setTimeout(() => {
            const fallback = window.__GODIESEL_ATLAS_REGION_OUTCOME__ === "fallback";
            if (canvas) {
              canvas.dataset.atlasState = fallback
                ? "region-fallback"
                : "region-ready";
              canvas.dataset.cameraState = "settled";
              canvas.dataset.terrainState = fallback ? "fallback" : "ready";
            }
            reportStatus?.({
              state: fallback ? "region-fallback" : "region-ready",
              regionName: region.name,
              message: fallback
                ? "3D terrain partially unavailable"
                : `${region.name} terrain ready.`,
            });
          }, duration);
        },
        setSelectedRoute(route) {
          if (canvas) canvas.dataset.selectedRoute = route?.slug ?? "";
        },
        setPreviewedRoute(route) {
          if (canvas) canvas.dataset.previewedRoute = route?.slug ?? "";
        },
        frameRoute(route) {
          if (!canvas) return;
          canvas.dataset.cameraRoute = route?.slug ?? "";
          cameraTarget = route
            ? Math.max(2_400, Math.round(route.distanceKm * 420))
            : selectedRegion?.includes("Banff")
              ? 42_000
              : 28_000;
          syncCamera();
        },
        projectRegions() {
          return regions.map((region, index) => ({
            name: region.name,
            x: 230 + (index % 5) * 155,
            y: 300 + Math.floor(index / 5) * 54,
            visible: index < 12 || region.name === selectedRegion,
          }));
        },
        zoomIn() {
          cameraTarget *= 0.72;
          syncCamera();
        },
        zoomOut() {
          cameraTarget *= 1.35;
          syncCamera();
        },
        resetView() {
          cameraTarget = 18_500_000;
          syncCamera();
        },
        destroy() {
          if (regionalTimer !== undefined) window.clearTimeout(regionalTimer);
          window.__GODIESEL_ATLAS_WORLD_DESTROY_COUNT__ += 1;
          canvas?.remove();
        },
      };
    };
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
    await page.goto("/#/atlas?view=world");

    const world = page.locator('[data-atlas-engine="cesium"][data-atlas-status]');
    const canvas = page.getByLabel("Interactive route globe");
    await expect(world).toHaveAttribute("data-atlas-status", "ready");
    await expect(canvas).toHaveAttribute("data-heat-lines", "67");
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

    if (viewport.name === "mobile") {
      for (const name of ["Show routes", "Explore terrain"]) {
        const lensControl = page.getByRole("button", { name });
        expect((await lensControl.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      }
    }

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
  await page.goto("/#/atlas?view=world");

  const canvas = page.getByLabel("Interactive route globe");
  const search = page.getByRole("textbox", {
    name: "Search regions, routes, replay-worthy days",
  });
  await search.fill("kyoto");
  await page
    .getByRole("button", { name: /Kyoto, Japan.*2 routes.*km/i })
    .click();
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

test("regional provider failure never blocks the route decision panel", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__GODIESEL_ATLAS_REGION_OUTCOME__ = "fallback";
  });
  await page.route("**/styles/liberty", (route) => route.abort());
  await installDeterministicCesiumAtlas(page);
  await page.goto("/#/atlas?region=Kyoto%2C+Japan");

  await expect(page.locator('div[data-atlas-engine="cesium"]')).toHaveAttribute(
    "data-atlas-status",
    "region-fallback",
  );
  await expect(
    page.getByRole("heading", { level: 2, name: "Kyoto, Japan" }),
  ).toBeVisible({ timeout: 2_000 });
  await expect(
    page.getByRole("region", { name: "Kyoto, Japan recorded routes" }),
  ).toBeVisible();
});

test("Cesium releases its renderer when Atlas unmounts", async ({ page }) => {
  await installDeterministicCesiumAtlas(page);
  await page.goto("/#/atlas");
  await expect(page.getByLabel("Interactive route globe")).toBeVisible();

  await page.getByRole("button", { name: "Open application navigation" }).click();
  await page
    .getByRole("dialog", { name: "goDiesel navigation" })
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
      .getByText("Fitting recorded routes to the terrain"),
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

  await second.getByRole("link", { name: "Open route" }).click();
  await expect(page).toHaveURL(new RegExp(`#/replay/${secondSlug}`));
  await page.goBack();
  await expect(page).toHaveURL(/#\/atlas\?region=Kyoto%2C\+Japan/);
  await expect(page).toHaveURL(new RegExp(`route=${secondSlug}`));
  await expect(second).toHaveAttribute("data-selected", "true");
});

test("route cards preview in place and frame terrain only after activation", async ({
  page,
}) => {
  await installDeterministicCesiumAtlas(page);
  await page.goto("/#/atlas?region=Kyoto%2C+Japan");

  const world = page.locator('div[data-atlas-engine="cesium"]');
  await expect(world).toHaveAttribute("data-atlas-status", "region-ready", {
    timeout: 15_000,
  });
  const canvas = page.getByLabel("Interactive route globe");
  const cards = page
    .getByRole("region", { name: "Kyoto, Japan recorded routes" })
    .locator("article[data-route-slug]");
  const target = cards.nth(1);
  const first = cards.nth(0);
  const firstSlug = await first.getAttribute("data-route-slug");
  const targetSlug = await target.getAttribute("data-route-slug");
  const selectTarget = target.getByRole("button", { name: /Select / });
  const regionalCameraTarget = await canvas.getAttribute("data-camera-target");

  await first.getByRole("button", { name: /Select / }).focus();
  await expect(canvas).toHaveAttribute("data-previewed-route", firstSlug!);
  await target.hover();
  await expect(canvas).toHaveAttribute("data-previewed-route", targetSlug!);
  await expect(page).not.toHaveURL(/route=/);
  await expect(canvas).toHaveAttribute("data-camera-target", regionalCameraTarget!);
  await page.mouse.move(10, 10);
  await expect(canvas).toHaveAttribute("data-previewed-route", firstSlug!);

  await selectTarget.focus();
  await expect(canvas).toHaveAttribute("data-previewed-route", targetSlug!);
  await expect(page).not.toHaveURL(/route=/);
  await expect(canvas).toHaveAttribute("data-camera-target", regionalCameraTarget!);

  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`route=${targetSlug}`));
  await expect(canvas).toHaveAttribute("data-selected-route", targetSlug!);
  await expect(canvas).toHaveAttribute("data-camera-route", targetSlug!);
  await expect(canvas).not.toHaveAttribute("data-camera-target", regionalCameraTarget!);

  await page.keyboard.press("Escape");
  await expect(page).not.toHaveURL(/route=/);
  await expect(canvas).toHaveAttribute("data-camera-route", "");
  await expect(canvas).toHaveAttribute("data-camera-target", regionalCameraTarget!);
});

test("carousel drag commits one route and frames it on the globe", async ({ page }) => {
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
  const secondSlug = await second.getAttribute("data-route-slug");
  await expect(canvas).toHaveAttribute("data-camera-route", secondSlug!);
  await expect(canvas).not.toHaveAttribute("data-camera-target", cameraTargetBeforeDrag!);
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
  await target.getByRole("link", { name: "Open route" }).click();

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
    const nextRoute = page.getByRole("button", { name: "Next route" });
    const nextRouteBox = await nextRoute.boundingBox();
    expect(nextRouteBox?.width).toBeGreaterThanOrEqual(44);
    expect(nextRouteBox?.height).toBeGreaterThanOrEqual(44);
    await nextRoute.click();
    await nextRoute.click();
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
    const selectedCard = carousel.locator('article[data-selected="true"]');
    await expect(selectedCard).toBeInViewport();
    const selectedBox = (await selectedCard.boundingBox())!;
    expect(
      Math.abs(
        selectedBox.x + selectedBox.width / 2 -
          (carouselBox!.x + carouselBox!.width / 2),
      ),
    ).toBeLessThan(3);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(viewport.width);
  });
}

for (const viewport of [
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
    expect((await carousel.boundingBox())!.height).toBeGreaterThan(250);
  });
}

declare global {
  interface Window {
    __GODIESEL_ATLAS_WORLD_DESTROY_COUNT__: number;
    __GODIESEL_ATLAS_REGION_OUTCOME__?: "ready" | "fallback";
  }
}

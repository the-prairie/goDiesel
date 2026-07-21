import { expect, test } from "@playwright/test";
import { PNG } from "pngjs";

async function installDeterministicCesiumAtlas(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    window.__GODIESEL_ATLAS_WORLD_DESTROY_COUNT__ = 0;
    window.__GODIESEL_ATLAS_WORLD_ENGINE__ = "cesium";
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
  test(`feature-flagged Cesium Atlas renders and selects places on ${viewport.name}`, async ({
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
    await expect(page.getByRole("heading", { name: region! })).toBeVisible();
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

test("Cesium failure preserves Atlas through the Three.js fallback", async ({ page }) => {
  await page.addInitScript(() => {
    window.__GODIESEL_ATLAS_WORLD_DESTROY_COUNT__ = 0;
    window.__GODIESEL_ATLAS_WORLD_ENGINE__ = "cesium";
    window.__GODIESEL_ATLAS_WORLD_FACTORY__ = () => ({
      async mount({ onStatus }) {
        onStatus({ state: "unavailable", message: "Synthetic provider failure." });
      },
      setSelectedRegion() {},
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

  await expect(page.locator('[data-atlas-engine="three-fallback"]')).toBeAttached();
  await expect(page.getByText("Cesium world unavailable. Showing the classic Atlas.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Kyoto, Japan" })).toBeVisible();
  await expect(page).toHaveURL(/region=Kyoto%2C\+Japan/);
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
  await expect(page.getByRole("heading", { name: "Kyoto, Japan" })).toBeVisible();
});

test("search, keyboard, and wheel input share the Cesium camera target", async ({
  page,
}) => {
  await installDeterministicCesiumAtlas(page);
  await page.goto("/#/atlas");

  const canvas = page.getByLabel("Interactive route globe");
  const search = page.getByRole("textbox", {
    name: "Search regions, routes, replay-worthy days",
  });
  await search.fill("kyoto");
  await page.getByRole("button", { name: /Kyoto, Japan2 routes/i }).click();
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
    fallback.locator('[data-regional-route-overlay="true"] path'),
  ).toHaveCount(4);
  await expect(page).toHaveURL(/region=Kyoto%2C\+Japan/);
  await expect(page.getByText("3D terrain partially unavailable.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Kyoto, Japan" })).toBeVisible();

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

  await page.getByRole("link", { name: "Finder" }).click();
  await expect(page).toHaveURL(/#\/finder/);
  await expect
    .poll(() => page.evaluate(() => window.__GODIESEL_ATLAS_WORLD_DESTROY_COUNT__))
    .toBe(1);
});

declare global {
  interface Window {
    __GODIESEL_ATLAS_WORLD_DESTROY_COUNT__: number;
    __GODIESEL_ATLAS_REGION_OUTCOME__?: "ready" | "fallback";
  }
}

import { expect, test } from "@playwright/test";

async function installDeterministicCesiumAtlas(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    window.__GODIESEL_ATLAS_WORLD_ENGINE__ = "cesium";
    window.__GODIESEL_ATLAS_WORLD_FACTORY__ = () => {
      let canvas: HTMLCanvasElement | undefined;
      let regions: Array<{ name: string }> = [];
      let selectedRegion: string | undefined;
      let cameraTarget = 18_500_000;
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
          cameraTarget = region ? 6_500_000 : 18_500_000;
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
    await expect(canvas).toHaveAttribute("data-camera-target", "6500000");

    await canvas.focus();
    await page.keyboard.press("ArrowRight");
    await expect(canvas).toHaveAttribute("data-camera-target", "6500010");

    const beforeZoom = Number(await canvas.getAttribute("data-camera-target"));
    await page.getByRole("button", { name: "Zoom in" }).click();
    await expect
      .poll(async () => Number(await canvas.getAttribute("data-camera-target")))
      .toBeLessThan(beforeZoom);
  });
}

test("Cesium failure preserves Atlas through the Three.js fallback", async ({ page }) => {
  await page.addInitScript(() => {
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
      destroy() {},
    });
  });
  await page.goto("/#/atlas?region=Kyoto%2C+Japan");

  await expect(page.locator('[data-atlas-engine="three-fallback"]')).toBeAttached();
  await expect(page.getByText("Cesium world unavailable. Showing the classic Atlas.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Kyoto, Japan" })).toBeVisible();
  await expect(page).toHaveURL(/region=Kyoto%2C\+Japan/);
});

test("Cesium enters a region selected by the initial URL", async ({ page }) => {
  await installDeterministicCesiumAtlas(page);
  await page.goto("/#/atlas?region=Kyoto%2C+Japan");

  const canvas = page.getByLabel("Interactive route globe");
  await expect(canvas).toHaveAttribute("data-camera-target", "6500000");
  await expect(page.getByRole("heading", { name: "Kyoto, Japan" })).toBeVisible();
});

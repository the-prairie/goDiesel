import { expect, test, type Page } from "@playwright/test";
import { PNG } from "pngjs";

declare global {
  interface Window {
    __atlasCaptureHiddenElements?: Array<[HTMLElement, string, string]>;
  }
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function installAtlasReplayJourneyEngine(page: Page) {
  await page.addInitScript(() => {
    const replayWindow = window as typeof window & {
      __atlasReplayModes?: string[];
      __atlasReplayDestroyCount?: number;
      __GODIESEL_REPLAY_ENGINE_FACTORY__?: (mode: "earth" | "atlas") => {
        mount(options: {
          onStatus(status: {
            state: "ready" | "partial";
            title: string;
            message: string;
          }): void;
        }): Promise<void>;
        setPose(): void;
        destroy(): void;
      };
    };
    replayWindow.__atlasReplayModes = [];
    replayWindow.__atlasReplayDestroyCount = 0;
    replayWindow.__GODIESEL_REPLAY_ENGINE_FACTORY__ = (mode) => ({
      async mount(options) {
        replayWindow.__atlasReplayModes?.push(mode);
        options.onStatus(
          mode === "earth"
            ? {
                state: "partial",
                title: "3D tiles partially unavailable",
                message: "Atlas remains available for this route.",
              }
            : {
                state: "ready",
                title: "Atlas replay ready",
                message: "The cartographic route is ready.",
              },
        );
      },
      setPose() {},
      destroy() {
        replayWindow.__atlasReplayDestroyCount =
          (replayWindow.__atlasReplayDestroyCount ?? 0) + 1;
      },
    });
  });
}

function boxesOverlap(first: Box, second: Box) {
  return (
    first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y
  );
}

async function canvasStats(page: Page) {
  const canvas = page.getByLabel("Interactive route globe");
  const bounds = await canvas.boundingBox();
  if (!bounds) return { nonBackground: 0, checksum: 0 };
  await page.evaluate(() => {
    const canvasElement = document.querySelector<HTMLCanvasElement>(
      '[aria-label="Interactive route globe"]',
    );
    if (!canvasElement) return;

    const visibleAncestors = new Set<Element>();
    for (let element: Element | null = canvasElement; element; element = element.parentElement) {
      visibleAncestors.add(element);
    }

    const hiddenElements: Array<[HTMLElement, string, string]> = [];
    document.body.querySelectorAll<HTMLElement>("*").forEach((element) => {
      if (visibleAncestors.has(element)) return;
      hiddenElements.push([
        element,
        element.style.getPropertyValue("visibility"),
        element.style.getPropertyPriority("visibility"),
      ]);
      element.style.setProperty("visibility", "hidden", "important");
    });
    window.__atlasCaptureHiddenElements = hiddenElements;
  });
  const width = Math.min(320, bounds.width);
  const height = Math.min(240, bounds.height);
  let screenshot: Buffer;
  try {
    screenshot = await page.screenshot({
      animations: "disabled",
      clip: {
        x: bounds.x + (bounds.width - width) / 2,
        y: bounds.y + (bounds.height - height) / 2,
        width,
        height,
      },
      scale: "css",
    });
  } finally {
    await page.evaluate(() => {
      window.__atlasCaptureHiddenElements?.forEach(
        ([element, visibility, priority]) => {
          if (visibility) element.style.setProperty("visibility", visibility, priority);
          else element.style.removeProperty("visibility");
        },
      );
      delete window.__atlasCaptureHiddenElements;
    });
  }
  const pixels = PNG.sync.read(screenshot).data;
  let nonBackground = 0;
  let checksum = 0;
  const stride = Math.max(4, Math.floor(pixels.length / 50_000 / 4) * 4);
  for (let index = 0; index < pixels.length; index += stride) {
    const value = pixels[index] + pixels[index + 1] + pixels[index + 2];
    const backgroundDistance =
      Math.abs(pixels[index] - 2) +
      Math.abs(pixels[index + 1] - 7) +
      Math.abs(pixels[index + 2] - 10);
    if (backgroundDistance > 24) nonBackground += 1;
    checksum = (checksum + value * (index + 1)) % 2_147_483_647;
  }
  return { nonBackground, checksum };
}

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`Atlas fills the available ${viewport.name} workspace with live pixels`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.setViewportSize(viewport);
    await page.goto("/#/atlas?view=world");
    const canvas = page.getByLabel("Interactive route globe");
    await expect(canvas).toBeVisible({ timeout: 15_000 });
    await expect(canvas).toHaveAttribute("data-heat-lines", "66", { timeout: 15_000 });
    const initialPixels = await canvasStats(page);
    expect(initialPixels.nonBackground).toBeGreaterThan(500);
    if (viewport.name === "desktop") {
      await expect(canvas).toHaveAttribute("data-atlas-engine", "cesium");

      await canvas.evaluate((element) => {
        element.style.visibility = "hidden";
      });
      const hiddenCanvasPixels = await canvasStats(page);
      expect(hiddenCanvasPixels.nonBackground).toBeLessThan(50);
      await canvas.evaluate((element) => {
        element.style.removeProperty("visibility");
      });
    }

    const layout = await page.evaluate(() => {
      const main = document.querySelector("main")!.getBoundingClientRect();
      const canvas = document
        .querySelector<HTMLCanvasElement>('[aria-label="Interactive route globe"]')!
        .getBoundingClientRect();
      const mobileNavigation = document
        .querySelector<HTMLElement>('[data-testid="atlas-spine-mobile"]')
        ?.getBoundingClientRect();
      return {
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        mobileNavigationHeight:
          mobileNavigation && mobileNavigation.height > 0 ? mobileNavigation.height : 0,
        main: { left: main.left, right: main.right, bottom: main.bottom },
        canvas: {
          left: canvas.left,
          right: canvas.right,
          bottom: canvas.bottom,
          height: canvas.height,
        },
      };
    });

    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
    expect(Math.abs(layout.canvas.left - layout.main.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(layout.canvas.right - layout.main.right)).toBeLessThanOrEqual(1);
    expect(Math.abs(layout.canvas.bottom - layout.main.bottom)).toBeLessThanOrEqual(1);
    expect(layout.canvas.height).toBeGreaterThanOrEqual(
      viewport.height - layout.mobileNavigationHeight - 1,
    );
  });
}

test("Atlas opens at the latest regional memory and keeps world view explicit", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto("/#/atlas");

  await expect(page).toHaveURL(/region=Tokyo%2C\+Japan/);
  await expect(
    page.getByRole("region", {
      name: "Tokyo, Japan recorded routes",
      exact: true,
    }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Show routes" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.getByRole("button", { name: "Explore terrain" }).click();
  await expect(page).toHaveURL(/lens=terrain/);
  await expect(page.getByRole("region", { name: "Tokyo, Japan terrain reading" })).toContainText(
    "Derived from recorded tracks",
  );

  await page.getByRole("button", { name: "All places" }).click();
  await expect(page).toHaveURL(/view=world/);
  await expect(page).not.toHaveURL(/region=/);
  await expect(page).not.toHaveURL(/lens=/);
  await expect(page.getByRole("region", { name: "Tokyo, Japan recorded routes" })).toHaveCount(0);

  await page.reload();
  await expect(page).toHaveURL(/view=world/);
  await expect(page.getByRole("region", { name: "Tokyo, Japan recorded routes" })).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/atlas?region=Tokyo%2C+Japan&lens=terrain");
  const terrainReading = page.getByRole("region", { name: "Tokyo, Japan terrain reading" });
  const routeRail = page.getByRole("region", { name: "Tokyo, Japan routes", exact: true });
  await expect(terrainReading).toBeVisible();
  await expect(routeRail).toBeVisible();
  const terrainBox = await terrainReading.boundingBox();
  const railBox = await routeRail.boundingBox();
  expect(terrainBox).not.toBeNull();
  expect(railBox).not.toBeNull();
  expect(terrainBox!.y + terrainBox!.height).toBeLessThanOrEqual(railBox!.y + 1);
});

test("globe label selection synchronizes the region URL and route carousel", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/#/atlas?view=world");

  const visibleGlobeLabel = page.locator("button[data-globe-region]:visible").first();
  await expect(visibleGlobeLabel).toBeVisible({ timeout: 15_000 });
  const globeRegion = await visibleGlobeLabel.getAttribute("data-globe-region");
  expect(globeRegion).not.toBeNull();
  await visibleGlobeLabel.click();
  await expect
    .poll(() => {
      const query = page.url().split("?")[1] ?? "";
      return new URLSearchParams(query).get("region");
    })
    .toBe(globeRegion);
  await expect(page.getByRole("heading", { level: 2, name: globeRegion! })).toBeVisible();
  await expect(
    page.getByRole("region", {
      name: `${globeRegion} recorded routes`,
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "All places" }).click();
  await expect(page).not.toHaveURL(/region=/);
});

test("region controls, search, carousel, and URL stay synchronized", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/#/atlas?view=world");

  await page.getByRole("combobox", { name: "Browse route regions" }).selectOption({
    label: "Canary Islands",
  });
  await expect(page).toHaveURL(/region=Canary\+Islands/);
  await expect(page.getByRole("heading", { level: 2, name: "Canary Islands" })).toBeVisible();

  await page.getByRole("button", { name: "All places" }).click();
  await expect(page).not.toHaveURL(/region=/);
  await expect(page.getByRole("heading", { level: 2, name: "Canary Islands" })).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/region=Canary\+Islands/);
  await expect(page.getByRole("heading", { level: 2, name: "Canary Islands" })).toBeVisible();
  await page.getByRole("button", { name: "All places" }).click();

  const search = page.getByRole("textbox", {
    name: "Search regions, routes, replay-worthy days",
  });
  await search.fill("bali");
  await expect(page).toHaveURL(/q=bali/);
  await page
    .getByRole("region", { name: "Atlas search" })
    .getByRole("button", { name: /^Bali, Indonesia5 routes/i })
    .click();
  await expect(page).toHaveURL(/region=Bali%2C\+Indonesia/);
  await expect(page.getByRole("heading", { level: 2, name: "Bali, Indonesia" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Atlas search" })).toHaveAttribute(
    "data-state",
    "grouped-results",
  );

  await page.reload();
  const atlasSearch = page.getByRole("region", { name: "Atlas search" });
  const baliCarousel = page.getByRole("region", {
    name: "Bali, Indonesia recorded routes",
    exact: true,
  });
  await expect(baliCarousel).toBeVisible({ timeout: 15_000 });
  const searchBox = await atlasSearch.boundingBox();
  const carouselBox = await baliCarousel.boundingBox();
  expect(searchBox).not.toBeNull();
  expect(carouselBox).not.toBeNull();
  expect(boxesOverlap(searchBox!, carouselBox!)).toBe(false);
  await expect(page.getByRole("region", { name: "Atlas search" })).toHaveAttribute(
    "data-state",
    "grouped-results",
  );
  const regionalSearch = page.getByRole("textbox", { name: "Search this place" });
  await expect(regionalSearch).toHaveAttribute("placeholder", "Search this place");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("heading", { level: 2, name: "Bali, Indonesia" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("combobox", { name: "Browse route regions" })).toHaveValue(
    "Bali, Indonesia",
  );
  const mobileSearchBox = await atlasSearch.boundingBox();
  const mobileCarouselBox = await baliCarousel.boundingBox();
  const controlsBox = await page
    .getByRole("combobox", { name: "Browse route regions" })
    .locator("..")
    .boundingBox();
  expect(mobileSearchBox).not.toBeNull();
  expect(mobileCarouselBox).not.toBeNull();
  expect(controlsBox).not.toBeNull();
  expect(boxesOverlap(mobileSearchBox!, mobileCarouselBox!)).toBe(false);
  expect(boxesOverlap(mobileCarouselBox!, controlsBox!)).toBe(false);

  await regionalSearch.fill("tokyo");
  await expect(page).toHaveURL(/region=Bali%2C\+Indonesia/);
  await expect(page.getByRole("heading", { level: 2, name: "Bali, Indonesia" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Browse route regions" })).toHaveValue("Bali, Indonesia");
  await expect(page.getByRole("region", { name: "Atlas search" })).toHaveAttribute(
    "data-state",
    "no-results",
  );
  await expect(page.getByRole("button", { name: /Tokyo, Japan3 routes/i })).toHaveCount(0);
});

test("global search focuses a completed route memory", async ({ page }) => {
  await page.goto("/#/atlas?view=world");

  const search = page.getByRole("textbox", {
    name: "Search regions, routes, replay-worthy days",
  });
  await search.fill("crosswalk sprints");
  const result = page
    .getByRole("region", { name: "Atlas search" })
    .getByRole("button", { name: /Tokyo, JapanRun · 21\.8 km/i });
  await expect(result).toBeVisible();
  await result.click();

  await expect(page).toHaveURL(/region=Tokyo%2C\+Japan/);
  await expect(page).toHaveURL(/route=17665674778/);
  await expect(
    page
      .getByRole("region", { name: "Tokyo, Japan recorded routes", exact: true })
      .locator('article[data-selected="true"]'),
  ).toHaveAttribute("data-route-slug", "17665674778");
});

test("desktop Atlas gives the world the full viewport width", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/atlas?view=world");

  const main = page.getByRole("main");
  const canvas = page.getByLabel("Interactive route globe");
  await expect(page.getByTestId("atlas-spine")).toHaveCount(0);
  await expect(page.getByTestId("atlas-compact-navigation")).toBeVisible();
  await expect(main).toHaveCSS("padding-left", "0px");

  const [mainBox, canvasBox] = await Promise.all([
    main.boundingBox(),
    canvas.boundingBox(),
  ]);
  expect(mainBox?.x).toBe(0);
  expect(mainBox?.width).toBe(1440);
  expect(canvasBox?.x).toBe(0);
  expect(canvasBox?.width).toBe(1440);
});

test("desktop Atlas exposes activity modes and working globe utilities", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/atlas?view=world");

  const canvas = page.getByLabel("Interactive route globe");
  await expect(canvas).toHaveAttribute("data-route-palette", "cobalt");
  const allHeatLines = Number(await canvas.getAttribute("data-heat-lines"));
  expect(allHeatLines).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Show rides" }).click();
  await expect(page).toHaveURL(/activity=rides/);
  await expect(page.getByRole("button", { name: "Show rides" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-heat-lines")))
    .toBeLessThan(allHeatLines);

  const cameraBefore = Number(await canvas.getAttribute("data-camera-target"));
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-camera-target")))
    .toBeLessThan(cameraBefore);
  await page.getByRole("button", { name: "Reset globe view" }).click();
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-camera-target")))
    .toBeGreaterThan(18_000_000);

  await page.getByRole("button", { name: "Show all activities" }).click();
  await expect(page).not.toHaveURL(/activity=/);
});

test("selected region opens a source-backed route carousel", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/atlas?region=Kyoto%2C+Japan");

  const carousel = page.getByRole("region", {
    name: "Kyoto, Japan recorded routes",
    exact: true,
  });
  await expect(carousel).toBeVisible();
  await expect(carousel.getByRole("article")).toHaveCount(2);
  await expect(carousel).toContainText(/Run|Ride/);
  await expect(carousel).toContainText(/km/);
  await expect(carousel.getByText(/Reviewed field note|Guide not yet reviewed/).first()).toBeVisible();
  await expect(carousel.getByRole("img", { name: /recorded route trace/ }).first()).toBeVisible();
  await expect(carousel.getByRole("img", { name: /elevation profile/ }).first()).toBeVisible();
});

test("route selection stays in Atlas and restores through history", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/atlas?region=Kyoto%2C+Japan");

  const carousel = page.getByRole("region", {
    name: "Kyoto, Japan recorded routes",
    exact: true,
  });
  await expect(page).toHaveURL(/#\/atlas\?region=Kyoto%2C\+Japan$/);
  await page.getByRole("button", { name: "Next route" }).click();
  const selectedSlug = new URL(page.url()).hash.match(/route=([^&]+)/)?.[1];
  expect(selectedSlug).toBeTruthy();
  const selectedCard = carousel.locator('article[data-selected="true"]');
  await expect(carousel.locator('article[data-selected="true"]')).toHaveCount(1);
  await expect(selectedCard.getByRole("link", { name: "Open route" })).toBeVisible();

  await page.reload();
  await expect(carousel.locator('article[data-selected="true"]')).toHaveCount(1);
  await page.goBack();
  await expect(page).toHaveURL(/#\/atlas\?region=Kyoto%2C\+Japan$/);
  await page.waitForTimeout(1_500);
  await expect(page).not.toHaveURL(/route=/);
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`route=${selectedSlug}`));
});

test("invalid Atlas selection is repaired and Escape closes one hierarchy level", async ({ page }) => {
  await page.goto("/#/atlas?region=Kyoto%2C+Japan&route=not-a-route");
  await expect(page).toHaveURL(/region=Kyoto%2C\+Japan/);
  await expect(page).not.toHaveURL(/route=/);
  await expect(
    page.getByRole("region", {
      name: "Kyoto, Japan recorded routes",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next route" }).click();
  await expect(page).toHaveURL(/route=/);
  await page.keyboard.press("Escape");
  await expect(page).not.toHaveURL(/route=/);
  await expect(page).toHaveURL(/region=Kyoto%2C\+Japan/);
  await page.keyboard.press("Escape");
  await expect(page).not.toHaveURL(/region=/);

  await page.goto("/#/atlas?region=Nowhere&route=missing");
  await expect(page).toHaveURL(/#\/atlas\?view=world$/);
});

test("Replay back control restores the originating Atlas selection", async ({ page }) => {
  await page.goto("/#/atlas?region=Kyoto%2C+Japan");
  const carousel = page.getByRole("region", {
    name: "Kyoto, Japan recorded routes",
    exact: true,
  });
  const selectedButton = carousel.getByRole("button", {
    name: /Select /,
    pressed: true,
  });
  await expect(selectedButton).toHaveCount(1);
  await selectedButton.click();
  const atlasUrl = page.url();
  await carousel
    .locator('article[data-selected="true"]')
    .getByRole("link", { name: "Open route" })
    .click();
  await expect(page).toHaveURL(/#\/replay\//);
  await page.getByRole("button", { name: "Back to Atlas" }).click();
  await expect(page).toHaveURL(atlasUrl);
});

test("browser Back restores Atlas selection after Replay fallback", async ({ page }) => {
  await installAtlasReplayJourneyEngine(page);
  await page.goto("/#/atlas?q=kyoto&region=Kyoto%2C+Japan");

  const carousel = page.getByRole("region", {
    name: "Kyoto, Japan recorded routes",
    exact: true,
  });
  const route = carousel
    .getByRole("article")
    .filter({ hasText: "A long, exploratory Kyoto run" });
  await route.getByRole("button", { name: /Select / }).click();
  await expect(route).toHaveAttribute("data-selected", "true");
  const selectedAtlasUrl = page.url();

  const replayPath = await route
    .getByRole("link", { name: "Open route" })
    .getAttribute("href");
  expect(replayPath).not.toBeNull();
  expect(replayPath).toContain("from=");
  await page.goto(`${replayPath}&renderer=cesium`);

  const stage = page.getByTestId("replay-stage");
  await expect(stage).toHaveAttribute("data-state", "partial");
  await page.getByRole("button", { name: "Use Atlas replay" }).click();
  await expect(stage).toHaveAttribute("data-engine", "maplibre-atlas");
  await expect(stage).toHaveAttribute("data-state", "ready");
  await expect
    .poll(() =>
      page.evaluate(() => ({
        modes: (window as typeof window & { __atlasReplayModes?: string[] })
          .__atlasReplayModes,
        destroyCount: (
          window as typeof window & { __atlasReplayDestroyCount?: number }
        ).__atlasReplayDestroyCount,
      })),
    )
    .toEqual({ modes: ["earth", "atlas"], destroyCount: 1 });

  await page.goBack();
  await expect(page).toHaveURL(selectedAtlasUrl);
  await expect(route).toHaveAttribute("data-selected", "true");
  await expect(page.getByRole("textbox", { name: "Search this place" })).toHaveValue(
    "kyoto",
  );
});

test("mobile Atlas carousel preserves map context and exposes a route peek", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/atlas?region=Kyoto%2C+Japan");

  const carousel = page.getByRole("region", {
    name: "Kyoto, Japan recorded routes",
    exact: true,
  });
  const world = page.getByLabel("Interactive route globe");
  const regionalMap = page.locator(
    '[data-atlas-engine="maplibre-regional-fallback"]',
  );
  await expect(carousel).toBeVisible();
  const firstCard = carousel.getByRole("article").first();
  const secondCard = carousel.getByRole("article").nth(1);
  const carouselBox = (await carousel.boundingBox())!;
  const firstCardBox = (await firstCard.boundingBox())!;
  const secondCardBox = (await secondCard.boundingBox())!;
  expect(firstCardBox.width / carouselBox.width).toBeGreaterThan(0.7);
  expect(secondCardBox.x).toBeLessThan(carouselBox.x + carouselBox.width);
  expect((await world.isVisible()) || (await regionalMap.isVisible())).toBe(true);
  await page.getByRole("button", { name: "Next route" }).click();
  await expect(secondCard).toHaveAttribute("data-selected", "true");
  await expect(page).toHaveURL(/region=Kyoto%2C\+Japan.*route=/);
});

test("mobile globe supports two-finger pinch without losing region state", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:8791",
    hasTouch: true,
    isMobile: true,
    viewport: { width: 430, height: 844 },
  });
  const page = await context.newPage();
  try {
    await page.goto("/#/atlas?view=world");
    const canvas = page.getByLabel("Interactive route globe");
    await expect(page.locator('div[data-atlas-engine="cesium"]')).toHaveAttribute(
      "data-atlas-status",
      "ready",
    );
    await expect(canvas).toHaveAttribute("data-camera-state", "settled");
    const readyTarget = Number(await canvas.getAttribute("data-camera-target"));
    expect(Math.abs(readyTarget - 18_500_000)).toBeLessThan(25_000);

    const before = readyTarget;
    const box = (await canvas.boundingBox())!;
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    const client = await context.newCDPSession(page);

    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { x: centerX - 45, y: centerY, id: 11 },
        { x: centerX + 45, y: centerY, id: 12 },
      ],
    });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: centerX - 100, y: centerY, id: 11 },
        { x: centerX + 100, y: centerY, id: 12 },
      ],
    });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });

    await expect
      .poll(async () => Number(await canvas.getAttribute("data-camera-target")))
      .toBeLessThan(before);
    await page.getByRole("combobox", { name: "Browse route regions" }).selectOption({
      label: "Kyoto, Japan",
    });
    await expect(page).toHaveURL(/region=Kyoto%2C\+Japan/);
  } finally {
    await context.close();
  }
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 667, height: 375 },
]) {
  test(`mobile Atlas controls and carousel fit ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/#/atlas?region=Kyoto%2C+Japan");

    const carouselSection = page.getByRole("region", { name: "Kyoto, Japan routes" });
    const mobileNavigation = page.getByTestId("atlas-spine-mobile");
    await expect(carouselSection).toBeVisible();
    if (viewport.height > 600) {
      await expect(page.getByRole("button", { name: "Show all activities" })).toBeVisible();
    } else {
      await expect(page.getByRole("button", { name: "Show all activities" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "All places" })).toBeVisible();
    }

    const layout = await page.evaluate(() => {
      const carousel = document.querySelector<HTMLElement>(
        'section[aria-label="Kyoto, Japan routes"]',
      )!;
      const navigation = document.querySelector<HTMLElement>(
        '[data-testid="atlas-spine-mobile"]',
      )!;
      const region = document.querySelector<HTMLElement>(".atlas-region-select");
      const activity = Array.from(
        document.querySelectorAll<HTMLElement>(
          '.atlas-mobile-activity[aria-label="Activity filter"]',
        ),
      ).find((element) => getComputedStyle(element).display !== "none");
      const buttons = Array.from(
        document.querySelectorAll<HTMLElement>(
          '.atlas-mobile-activity [data-slot="button"], .atlas-mobile-map-tools [data-slot="button"]',
        ),
      );
      return {
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        carouselBottom: carousel.getBoundingClientRect().bottom,
        navigationTop: navigation.getBoundingClientRect().top,
        toolbarTopDelta:
          region && activity
            ? Math.abs(region.getBoundingClientRect().top - activity.getBoundingClientRect().top)
            : null,
        toolbarHeightDelta:
          region && activity
            ? Math.abs(region.getBoundingClientRect().height - activity.getBoundingClientRect().height)
            : null,
        minimumTarget: Math.min(
          ...buttons
            .map((button) => button.getBoundingClientRect().height)
            .filter((height) => height > 0),
        ),
      };
    });

    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
    expect(layout.carouselBottom).toBeLessThanOrEqual(layout.navigationTop + 1);
    if (layout.toolbarTopDelta !== null) expect(layout.toolbarTopDelta).toBeLessThanOrEqual(1);
    if (layout.toolbarHeightDelta !== null) expect(layout.toolbarHeightDelta).toBeLessThanOrEqual(1);
    expect(layout.minimumTarget).toBeGreaterThanOrEqual(44);
    await expect(mobileNavigation).toBeVisible();
  });
}

for (const viewport of [
  { width: 390, height: 320 },
  { width: 390, height: 844 },
  { width: 667, height: 375 },
  { width: 768, height: 576 },
  { width: 768, height: 577 },
  { width: 1280, height: 320 },
]) {
  test(`Atlas overlays stay separate at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    await page.goto("/#/atlas?view=world");
    const heading = page.getByRole("heading", { name: "Real places, playable days." });
    const search = page.getByRole("region", { name: "Atlas search" });
    await expect(search).toBeVisible({ timeout: 15_000 });
    const headingBox = (await heading.isVisible()) ? await heading.boundingBox() : null;
    const searchBox = await search.boundingBox();
    expect(searchBox).not.toBeNull();
    if (headingBox) expect(boxesOverlap(headingBox, searchBox!)).toBe(false);

    await page.getByRole("combobox", { name: "Browse route regions" }).selectOption({
      label: "Canary Islands",
    });
    const carouselSection = page.getByRole("region", { name: "Canary Islands routes" });
    const carousel = page.getByRole("region", {
      name: "Canary Islands recorded routes",
      exact: true,
    });
    await expect(carouselSection).toBeVisible();
    await expect(carousel).toBeVisible();
    const selectedSearchBox = (await search.isVisible())
      ? await search.boundingBox()
      : null;
    const carouselBox = await carouselSection.boundingBox();
    const controlsBox = viewport.height > 600
      ? await page
          .getByRole("combobox", { name: "Browse route regions" })
          .locator("..")
          .boundingBox()
      : null;
    expect(carouselBox).not.toBeNull();
    if (viewport.height > 600) expect(controlsBox).not.toBeNull();
    if (selectedSearchBox) {
      expect(boxesOverlap(selectedSearchBox, carouselBox!)).toBe(false);
    }
    if (controlsBox) expect(boxesOverlap(carouselBox!, controlsBox)).toBe(false);
    const clearSelection = page.getByRole("button", { name: "All places" });
    await expect(clearSelection).toBeVisible();
    if (
      viewport.height === 320 ||
      viewport.width === 667
    ) {
      const secondRoute = carousel.getByRole("article").nth(1);
      await expect(secondRoute).toBeVisible();
      await page.getByRole("button", { name: "Next route" }).click();
      await expect(page).toHaveURL(/#\/atlas\?.*route=/);
      await expect(secondRoute).toHaveAttribute("data-selected", "true");
      await expect(secondRoute.getByRole("link", { name: "Open route" })).toBeVisible();
      await page.goBack();
      await expect(clearSelection).toBeVisible();
    }
    await clearSelection.click();
    await expect(page).not.toHaveURL(/region=/);
  });
}

test("desktop Atlas toolbar controls share one alignment rhythm", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/#/atlas?view=world");

  const region = page.locator(".atlas-region-select");
  const search = page.getByRole("region", { name: "Atlas search" });
  const activity = page.locator('.atlas-desktop-activity[aria-label="Activity filter"]');
  await expect(region).toBeVisible();
  await expect(search).toBeVisible();
  await expect(activity).toBeVisible();

  const compactNavigation = page.getByTestId("atlas-compact-navigation");
  const modeNavigation = page.getByTestId("atlas-mode-navigation");
  const boxes = await Promise.all([
    compactNavigation.boundingBox(),
    region.boundingBox(),
    search.boundingBox(),
    activity.boundingBox(),
    modeNavigation.boundingBox(),
  ]);
  expect(boxes.every(Boolean)).toBe(true);
  const [compactBox, regionBox, searchBox, activityBox, modeBox] = boxes as Box[];

  expect(Math.max(regionBox.y, searchBox.y, activityBox.y) - Math.min(regionBox.y, searchBox.y, activityBox.y)).toBeLessThanOrEqual(1);
  expect(Math.max(regionBox.height, searchBox.height, activityBox.height) - Math.min(regionBox.height, searchBox.height, activityBox.height)).toBeLessThanOrEqual(1);
  expect(searchBox.x - (regionBox.x + regionBox.width)).toBeCloseTo(8, 0);
  expect(activityBox.x - (searchBox.x + searchBox.width)).toBeCloseTo(8, 0);
  expect(boxesOverlap(compactBox, regionBox)).toBe(false);
  expect(boxesOverlap(activityBox, modeBox)).toBe(false);
});

test("short-landscape search results remain actionable", async ({ page }) => {
  await page.setViewportSize({ width: 667, height: 375 });
  await page.goto("/#/atlas?view=world");
  const search = page.getByRole("textbox", {
    name: "Search regions, routes, replay-worthy days",
  });
  await search.fill("bali");
  await expect(page).toHaveURL(/q=bali/);
  const baliResult = page
    .getByRole("region", { name: "Atlas search" })
    .getByRole("button", { name: /^Bali, Indonesia5 routes/i });
  await baliResult.scrollIntoViewIfNeeded();
  await expect(baliResult).toBeVisible();
  await baliResult.click();
  await expect(page).toHaveURL(/region=Bali%2C\+Indonesia/);
  await expect(page.getByRole("heading", { level: 2, name: "Bali, Indonesia" })).toBeVisible();
  await page.getByRole("button", { name: "All places" }).click();
  await expect(page).not.toHaveURL(/region=/);
});

test("globe supports pointer, wheel, and keyboard exploration", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/#/atlas?view=world");
  const canvas = page.getByLabel("Interactive route globe");
  await expect(canvas).toHaveAttribute("data-heat-lines", "66", { timeout: 15_000 });
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) return;

  const state = async () =>
    canvas.evaluate((element) => ({
      heading: Number(element.dataset.cameraHeading),
      pitch: Number(element.dataset.cameraPitch),
      cameraDistance: Number(element.dataset.cameraTarget),
    }));

  const beforeMouse = await state();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 80, bounds.y + bounds.height / 2 + 30);
  await page.mouse.up();
  await expect
    .poll(async () => {
      const afterMouse = await state();
      return (
        afterMouse.heading !== beforeMouse.heading ||
        afterMouse.pitch !== beforeMouse.pitch
      );
    })
    .toBe(true);

  const beforeWheel = await state();
  await canvas.dispatchEvent("wheel", { deltaY: -120 });
  const afterWheel = await state();
  expect(afterWheel.cameraDistance).toBeLessThan(beforeWheel.cameraDistance);

  await canvas.focus();
  expect(
    await canvas.evaluate((element) => getComputedStyle(element).boxShadow),
  ).not.toBe("none");
  const beforeKeyboard = await state();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("+");
  await page.waitForTimeout(180);
  const afterKeyboard = await state();
  expect(afterKeyboard.cameraDistance).toBeLessThan(beforeKeyboard.cameraDistance);
});

test("Atlas uses the production Cesium world and canonicalizes invalid regions", async ({
  page,
}) => {
  const obsoleteTextureRequests: string[] = [];
  page.on("response", (response) => {
    if (response.url().includes("earth-atmos-2048")) {
      obsoleteTextureRequests.push(response.url());
    }
  });

  await page.goto("/#/atlas?region=Not+A+Place");
  const world = page.locator('div[data-atlas-engine="cesium"]');
  const canvas = page.getByLabel("Interactive route globe");
  await expect(world).toHaveAttribute("data-atlas-status", "ready", {
    timeout: 15_000,
  });
  await expect(canvas).toHaveAttribute("data-atlas-engine", "cesium");
  await expect(page).not.toHaveURL(/region=/);
  expect(obsoleteTextureRequests).toEqual([]);
});

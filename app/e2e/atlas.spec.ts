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

function boxesOverlap(first: Box, second: Box) {
  return (
    first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y
  );
}

async function openAtlasSearch(page: Page) {
  const search = page.getByRole("region", { name: "Atlas search" });
  if (!(await search.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Search the Atlas" }).click();
  }
  await expect(search).toBeVisible();
  return search;
}

async function selectRegionFromSearch(page: Page, regionName: string) {
  const search = await openAtlasSearch(page);
  let region = search
    .getByRole("button")
    .filter({ hasText: regionName })
    .first();
  if ((await region.count()) === 0) {
    await search
      .getByRole("textbox", {
        name: "Search regions, routes, replay-worthy days",
      })
      .fill(regionName);
    region = search
      .getByRole("button")
      .filter({ hasText: regionName })
      .first();
  }
  await region.scrollIntoViewIfNeeded();
  await region.click();
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
    await page.goto("/#/atlas");
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

test("featured region selection synchronizes the URL and route carousel", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/#/atlas");

  await page.getByRole("button", { name: "Explore Crete" }).click();
  await expect(page).toHaveURL(/region=Crete%2C\+Greece/);
  await expect(page.getByRole("heading", { level: 1, name: "Crete, Greece" })).toBeVisible();
  await expect(
    page.getByRole("region", {
      name: "Crete, Greece recorded routes",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close Crete, Greece routes" }).click();
  await expect(page).not.toHaveURL(/region=/);
});

test("region controls, search, carousel, and URL stay synchronized", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/#/atlas");

  await selectRegionFromSearch(page, "Canary Islands");
  await expect(page).toHaveURL(/region=Canary\+Islands/);
  await expect(page.getByRole("heading", { level: 1, name: "Canary Islands" })).toBeVisible();

  await page.getByRole("button", { name: "Close Canary Islands routes" }).click();
  await expect(page).not.toHaveURL(/region=/);
  await expect(page.getByRole("heading", { level: 1, name: "Canary Islands" })).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/region=Canary\+Islands/);
  await expect(page.getByRole("heading", { level: 1, name: "Canary Islands" })).toBeVisible();
  await page.getByRole("button", { name: "Close Canary Islands routes" }).click();

  const atlasSearch = await openAtlasSearch(page);
  const search = atlasSearch.getByRole("textbox", {
    name: "Search regions, routes, replay-worthy days",
  });
  await search.fill("bali");
  await expect(page).toHaveURL(/q=bali/);
  await atlasSearch
    .getByRole("button", { name: /^Bali, Indonesia5 routes/i })
    .click();
  await expect(page).toHaveURL(/region=Bali%2C\+Indonesia/);
  await expect(page.getByRole("heading", { level: 1, name: "Bali, Indonesia" })).toBeVisible();
  await expect(atlasSearch).toHaveCount(0);

  await page.reload();
  const baliCarousel = page.getByRole("region", {
    name: "Bali, Indonesia recorded routes",
    exact: true,
  });
  await expect(baliCarousel).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("region", { name: "Atlas search" })).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Bali, Indonesia" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("button", { name: "World" })).toBeVisible();
});

test("global search focuses a completed route memory", async ({ page }) => {
  await page.goto("/#/atlas");

  const atlasSearch = await openAtlasSearch(page);
  const search = atlasSearch.getByRole("textbox", {
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
  await page.goto("/#/atlas");

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
  await page.goto("/#/atlas");

  const canvas = page.getByLabel("Interactive route globe");
  await expect(canvas).toHaveAttribute("data-route-palette", "cobalt");
  const allHeatLines = Number(await canvas.getAttribute("data-heat-lines"));
  expect(allHeatLines).toBeGreaterThan(0);

  const search = await openAtlasSearch(page);
  await search.getByRole("button", { name: "Show rides" }).click();
  await expect(page).toHaveURL(/activity=rides/);
  await expect(search.getByRole("button", { name: "Show rides" })).toHaveAttribute(
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
    .toBeGreaterThan(13_000_000);
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-camera-target")))
    .toBeLessThan(13_500_000);

  const reopenedSearch = await openAtlasSearch(page);
  await reopenedSearch.getByRole("button", { name: "Show all activities" }).click();
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
  await expect(page).toHaveURL(/#\/atlas$/);
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
  await page.getByRole("link", { name: "Back to Atlas" }).click();
  await expect(page).toHaveURL(atlasUrl);
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

test("mobile globe zoom keeps region selection available", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 844 });
  await page.goto("/#/atlas");
  const canvas = page.getByLabel("Interactive route globe");
  await expect(page.locator('div[data-atlas-engine="cesium"]')).toHaveAttribute(
    "data-atlas-status",
    "ready",
  );
  const before = Number(await canvas.getAttribute("data-camera-target"));

  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect
    .poll(async () => Number(await canvas.getAttribute("data-camera-target")))
    .toBeLessThan(before);
  await selectRegionFromSearch(page, "Kyoto, Japan");
  await expect(page).toHaveURL(/region=Kyoto%2C\+Japan/);
});

for (const viewport of [
  { width: 430, height: 844 },
  { width: 390, height: 844 },
  { width: 320, height: 568 },
  { width: 667, height: 375 },
]) {
  test(`mobile Atlas controls and carousel fit ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/#/atlas?region=Kyoto%2C+Japan");

    const carouselSection = page.getByRole("region", { name: "Kyoto, Japan routes" });
    const mobileNavigation = page.getByTestId("atlas-spine-mobile");
    await expect(carouselSection).toBeVisible();
    await expect(page.getByRole("button", { name: "Close Kyoto, Japan routes" })).toBeVisible();

    const layout = await page.evaluate(() => {
      const carousel = document.querySelector<HTMLElement>(
        'section[aria-label="Kyoto, Japan routes"]',
      )!;
      const navigation = document.querySelector<HTMLElement>(
        '[data-testid="atlas-spine-mobile"]',
      )!;
      const buttons = Array.from(
        document.querySelectorAll<HTMLElement>(
          'section[aria-label="Kyoto, Japan routes"] button',
        ),
      );
      return {
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        carouselBottom: carousel.getBoundingClientRect().bottom,
        navigationTop: navigation.getBoundingClientRect().top,
        minimumTarget: Math.min(
          ...buttons
            .map((button) => button.getBoundingClientRect().height)
            .filter((height) => height > 0),
        ),
      };
    });

    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
    expect(layout.carouselBottom).toBeLessThanOrEqual(layout.navigationTop + 1);
    expect(layout.minimumTarget).toBeGreaterThanOrEqual(40);
    await expect(mobileNavigation).toBeVisible();
  });
}

for (const viewport of [
  { width: 390, height: 320 },
  { width: 390, height: 576 },
  { width: 390, height: 577 },
  { width: 390, height: 640 },
  { width: 568, height: 320 },
  { width: 640, height: 320 },
  { width: 640, height: 844 },
  { width: 640, height: 600 },
  { width: 667, height: 375 },
  { width: 768, height: 900 },
  { width: 768, height: 640 },
  { width: 768, height: 576 },
  { width: 768, height: 577 },
  { width: 768, height: 390 },
  { width: 1024, height: 900 },
  { width: 844, height: 390 },
  { width: 1280, height: 320 },
  { width: 1440, height: 320 },
]) {
  test(`Atlas overlays stay separate at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    await page.goto("/#/atlas");
    const compactNavigation = page.getByTestId("atlas-compact-navigation");
    const modeNavigation = page.getByTestId("atlas-mode-navigation");
    await expect(compactNavigation).toBeVisible({ timeout: 15_000 });
    await expect(modeNavigation).toBeVisible();
    const globalLayout = await page.evaluate(() => {
      const navigation = document.querySelector<HTMLElement>(
        '[data-testid="atlas-compact-navigation"]',
      )!;
      const mode = document.querySelector<HTMLElement>(
        '[data-testid="atlas-mode-navigation"]',
      )!;
      const search = document.querySelector<HTMLElement>(
        'button[aria-label="Search the Atlas"]',
      )!;
      const navigationBox = navigation.getBoundingClientRect();
      const modeBox = mode.getBoundingClientRect();
      const searchBox = search.getBoundingClientRect();
      return {
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        navigationLeft: navigationBox.left,
        navigationRight: navigationBox.right,
        modeTop: modeBox.top,
        modeBottom: modeBox.bottom,
        navigationTop: navigationBox.top,
        navigationBottom: navigationBox.bottom,
        modeRight: modeBox.right,
        searchLeft: searchBox.left,
      };
    });
    expect(globalLayout.documentWidth).toBeLessThanOrEqual(
      globalLayout.viewportWidth + 1,
    );
    expect(globalLayout.navigationLeft).toBeGreaterThanOrEqual(0);
    expect(globalLayout.navigationRight).toBeLessThanOrEqual(
      globalLayout.viewportWidth + 1,
    );
    expect(globalLayout.modeTop).toBeGreaterThanOrEqual(
      globalLayout.navigationTop,
    );
    expect(globalLayout.modeBottom).toBeLessThanOrEqual(
      globalLayout.navigationBottom,
    );
    expect(globalLayout.modeRight).toBeLessThanOrEqual(
      globalLayout.searchLeft + 1,
    );

    await page.goto("/#/atlas?region=Canary+Islands");
    const carouselSection = page.getByRole("region", { name: "Canary Islands routes" });
    const carousel = page.getByRole("region", {
      name: "Canary Islands recorded routes",
      exact: true,
    });
    await expect(carouselSection).toBeVisible();
    await expect(carousel).toBeVisible();
    const carouselBox = await carouselSection.boundingBox();
    expect(carouselBox).not.toBeNull();
    const regionNavigation = page.getByTestId("atlas-compact-navigation");
    const regionNavigationBox = await regionNavigation.boundingBox();
    expect(regionNavigationBox).not.toBeNull();
    const headerOwnsVisibleEdge = await page.evaluate(({ x, y }) => {
      const visibleElement = document.elementFromPoint(x, y);
      return Boolean(
        visibleElement?.closest('[data-testid="atlas-compact-navigation"]'),
      );
    }, {
      x: Math.min(viewport.width - 2, regionNavigationBox!.x + 48),
      y: Math.min(viewport.height - 2, regionNavigationBox!.y + regionNavigationBox!.height / 2),
    });
    expect(headerOwnsVisibleEdge).toBe(true);
    const clearSelection =
      viewport.height <= 360
        ? page.getByRole("button", { name: "World" })
        : page.getByRole("button", { name: "Close Canary Islands routes" });
    await expect(clearSelection).toBeVisible();
    if (
      viewport.height === 576 ||
      viewport.height === 577 ||
      (viewport.width === 844 && viewport.height === 390)
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

test("desktop Atlas navigation keeps one alignment rhythm", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/#/atlas");

  const compactNavigation = page.getByTestId("atlas-compact-navigation");
  const modeNavigation = page.getByTestId("atlas-mode-navigation");
  const searchButton = page.getByRole("button", { name: "Search the Atlas" });
  const boxes = await Promise.all([
    compactNavigation.boundingBox(),
    modeNavigation.boundingBox(),
    searchButton.boundingBox(),
  ]);
  expect(boxes.every(Boolean)).toBe(true);
  const [compactBox, modeBox, searchBox] = boxes as Box[];

  expect(
    Math.max(compactBox.y, modeBox.y, searchBox.y) -
      Math.min(compactBox.y, modeBox.y, searchBox.y),
  ).toBeLessThanOrEqual(16);
  expect(modeBox.y).toBeGreaterThanOrEqual(compactBox.y);
  expect(modeBox.y + modeBox.height).toBeLessThanOrEqual(
    compactBox.y + compactBox.height,
  );
  expect(boxesOverlap(modeBox, searchBox)).toBe(false);
});

test("short-landscape search results remain actionable", async ({ page }) => {
  await page.setViewportSize({ width: 667, height: 375 });
  await page.goto("/#/atlas");
  const atlasSearch = await openAtlasSearch(page);
  const search = atlasSearch.getByRole("textbox", {
    name: "Search regions, routes, replay-worthy days",
  });
  await search.fill("bali");
  await expect(page).toHaveURL(/q=bali/);
  const baliResult = atlasSearch
    .getByRole("button", { name: /^Bali, Indonesia5 routes/i });
  await baliResult.scrollIntoViewIfNeeded();
  await expect(baliResult).toBeVisible();
  await baliResult.click();
  await expect(page).toHaveURL(/region=Bali%2C\+Indonesia/);
  await expect(page.getByRole("heading", { level: 1, name: "Bali, Indonesia" })).toBeVisible();
  await page.getByRole("button", { name: "Close Bali, Indonesia routes" }).click();
  await expect(page).not.toHaveURL(/region=/);
});

test("globe supports pointer, wheel, and keyboard exploration", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/#/atlas");
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

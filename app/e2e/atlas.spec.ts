import { expect, test, type Page } from "@playwright/test";
import { PNG } from "pngjs";

declare global {
  interface Window {
    __atlasCaptureHiddenElements?: Array<[HTMLElement, string, string]>;
  }
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
      await page.waitForTimeout(180);
      const movingPixels = await canvasStats(page);
      expect(movingPixels.checksum).not.toBe(initialPixels.checksum);

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
      return {
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
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
    expect(layout.canvas.height).toBeGreaterThanOrEqual(viewport.height - 60);
  });
}

test("canvas selection synchronizes the region URL and inspector", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/#/atlas");

  const visibleGlobeLabel = page.locator("button[data-globe-region]:visible").first();
  await expect(visibleGlobeLabel).toBeVisible({ timeout: 15_000 });
  const globeRegion = await visibleGlobeLabel.getAttribute("data-globe-region");
  const globeLabelBox = await visibleGlobeLabel.boundingBox();
  expect(globeRegion).not.toBeNull();
  expect(globeLabelBox).not.toBeNull();
  await page.locator("button[data-globe-region]").evaluateAll((labels) => {
    labels.forEach((label) => {
      (label as HTMLElement).style.visibility = "hidden";
    });
  });
  await page.mouse.click(
    globeLabelBox!.x + globeLabelBox!.width / 2,
    globeLabelBox!.y + globeLabelBox!.height / 2,
  );
  await page.locator("button[data-globe-region]").evaluateAll((labels) => {
    labels.forEach((label) => {
      (label as HTMLElement).style.removeProperty("visibility");
    });
  });
  await expect
    .poll(() => {
      const query = page.url().split("?")[1] ?? "";
      return new URLSearchParams(query).get("region");
    })
    .toBe(globeRegion);
  await expect(page.getByRole("heading", { name: globeRegion! })).toBeVisible();
  await page.getByRole("button", { name: "Clear selected region" }).click();
  await expect(page).not.toHaveURL(/region=/);
});

test("region controls, search, inspector, and URL stay synchronized", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/#/atlas");

  await page.getByRole("combobox", { name: "Browse route regions" }).selectOption({
    label: "Canary Islands",
  });
  await expect(page).toHaveURL(/region=Canary\+Islands/);
  await expect(page.getByRole("heading", { name: "Canary Islands" })).toBeVisible();

  await page.getByRole("button", { name: "Clear selected region" }).click();
  await expect(page).not.toHaveURL(/region=/);
  await expect(page.getByRole("heading", { name: "Canary Islands" })).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/region=Canary\+Islands/);
  await expect(page.getByRole("heading", { name: "Canary Islands" })).toBeVisible();
  await page.getByRole("button", { name: "Clear selected region" }).click();

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
  await expect(page.getByRole("heading", { name: "Bali, Indonesia" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Atlas search" })).toHaveAttribute(
    "data-state",
    "selected-result",
  );

  await page.reload();
  const atlasSearch = page.getByRole("region", { name: "Atlas search" });
  const baliInspector = page.locator("aside").filter({
    has: page.getByRole("heading", { name: "Bali, Indonesia" }),
  });
  await expect(baliInspector).toBeVisible({ timeout: 15_000 });
  const searchBox = await atlasSearch.boundingBox();
  const inspectorBox = await baliInspector.boundingBox();
  expect(searchBox).not.toBeNull();
  expect(inspectorBox).not.toBeNull();
  expect(searchBox!.y + searchBox!.height).toBeLessThanOrEqual(inspectorBox!.y);
  await expect(page.getByRole("region", { name: "Atlas search" })).toHaveAttribute(
    "data-state",
    "selected-result",
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Bali, Indonesia" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("combobox", { name: "Browse route regions" })).toHaveValue(
    "Bali, Indonesia",
  );
  const mobileSearchBox = await atlasSearch.boundingBox();
  const mobileInspectorBox = await baliInspector.boundingBox();
  const controlsBox = await page
    .getByRole("combobox", { name: "Browse route regions" })
    .locator("..")
    .boundingBox();
  expect(mobileSearchBox).not.toBeNull();
  expect(mobileInspectorBox).not.toBeNull();
  expect(controlsBox).not.toBeNull();
  expect(mobileSearchBox!.y + mobileSearchBox!.height).toBeLessThanOrEqual(
    mobileInspectorBox!.y,
  );
  expect(mobileInspectorBox!.y + mobileInspectorBox!.height).toBeLessThanOrEqual(
    controlsBox!.y,
  );

  await search.fill("tokyo");
  await expect(page).not.toHaveURL(/region=/);
  await expect(page.getByRole("heading", { name: "Bali, Indonesia" })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Browse route regions" })).toHaveValue("");
  await expect(page.getByRole("region", { name: "Atlas search" })).toHaveAttribute(
    "data-state",
    "grouped-results",
  );
  await expect(page.getByRole("button", { name: /Tokyo, Japan3 routes/i })).toBeVisible();
});

test("Atlas heading and search stay separate at tablet widths", async ({ page }) => {
  for (const viewport of [
    { width: 640, height: 844 },
    { width: 768, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/#/atlas");
    const heading = page.getByRole("heading", { name: "Real places, playable days." });
    const search = page.getByRole("region", { name: "Atlas search" });
    await expect(search).toBeVisible({ timeout: 15_000 });
    const headingBox = await heading.boundingBox();
    const searchBox = await search.boundingBox();
    expect(headingBox).not.toBeNull();
    expect(searchBox).not.toBeNull();
    expect(headingBox!.y + headingBox!.height).toBeLessThanOrEqual(searchBox!.y);
  }
});

test("globe supports pointer, wheel, touch, and keyboard exploration", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/#/atlas");
  const canvas = page.getByLabel("Interactive route globe");
  await expect(canvas).toHaveAttribute("data-heat-lines", "66", { timeout: 15_000 });
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) return;

  const state = async () =>
    canvas.evaluate((element) => ({
      rotationX: Number(element.dataset.targetRotationX),
      rotationY: Number(element.dataset.targetRotationY),
      cameraDistance: Number(element.dataset.cameraTarget),
    }));

  const beforeMouse = await state();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 80, bounds.y + bounds.height / 2 + 30);
  await page.mouse.up();
  const afterMouse = await state();
  expect(afterMouse.rotationX).not.toBe(beforeMouse.rotationX);
  expect(afterMouse.rotationY).not.toBe(beforeMouse.rotationY);

  const beforeWheel = await state();
  await canvas.dispatchEvent("wheel", { deltaY: -120 });
  const afterWheel = await state();
  expect(afterWheel.cameraDistance).toBeLessThan(beforeWheel.cameraDistance);

  const beforeTouch = await state();
  await canvas.dispatchEvent("pointerdown", {
    pointerId: 9,
    pointerType: "touch",
    clientX: bounds.x + 100,
    clientY: bounds.y + 100,
  });
  await canvas.dispatchEvent("pointermove", {
    pointerId: 9,
    pointerType: "touch",
    clientX: bounds.x + 130,
    clientY: bounds.y + 120,
  });
  await canvas.dispatchEvent("pointerup", {
    pointerId: 9,
    pointerType: "touch",
    clientX: bounds.x + 130,
    clientY: bounds.y + 120,
  });
  const afterTouch = await state();
  expect(afterTouch.rotationX).not.toBe(beforeTouch.rotationX);
  expect(afterTouch.rotationY).not.toBe(beforeTouch.rotationY);

  await canvas.focus();
  expect(
    await canvas.evaluate((element) => getComputedStyle(element).boxShadow),
  ).not.toBe("none");
  const beforeKeyboard = await state();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("+");
  await page.waitForTimeout(180);
  const afterKeyboard = await state();
  expect(afterKeyboard.rotationY).not.toBe(beforeKeyboard.rotationY);
  expect(afterKeyboard.cameraDistance).toBeLessThan(beforeKeyboard.cameraDistance);
});

test("Atlas uses the bundled landmass texture and canonicalizes invalid regions", async ({
  page,
}) => {
  const textureResponses: Array<{ url: string; status: number }> = [];
  page.on("response", (response) => {
    if (response.url().includes("earth-atmos-2048")) {
      textureResponses.push({ url: response.url(), status: response.status() });
    }
  });

  await page.goto("/#/atlas?region=Not+A+Place");
  await expect(page.getByLabel("Interactive route globe")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel("Interactive route globe")).toHaveAttribute(
    "data-texture-status",
    "loaded",
    { timeout: 15_000 },
  );
  await expect(page).not.toHaveURL(/region=/);
  await expect.poll(() => textureResponses.length).toBeGreaterThan(0);
  expect(textureResponses[0].url).toContain("/assets/earth-atmos-2048.jpg");
  expect(textureResponses[0].status).toBe(200);
});

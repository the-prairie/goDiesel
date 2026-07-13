import { expect, test, type Page } from "@playwright/test";
import { PNG } from "pngjs";

async function canvasStats(page: Page) {
  const screenshot = await page.getByLabel("Interactive route globe").screenshot();
  const pixels = PNG.sync.read(screenshot).data;
  let nonblank = 0;
  let checksum = 0;
  const stride = Math.max(4, Math.floor(pixels.length / 50_000 / 4) * 4);
  for (let index = 0; index < pixels.length; index += stride) {
    const value = pixels[index] + pixels[index + 1] + pixels[index + 2];
    if (value > 12) nonblank += 1;
    checksum = (checksum + value * (index + 1)) % 2_147_483_647;
  }
  return { nonblank, checksum };
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
    expect(initialPixels.nonblank).toBeGreaterThan(500);
    if (viewport.name === "desktop") {
      await page.waitForTimeout(180);
      const movingPixels = await canvasStats(page);
      expect(movingPixels.checksum).not.toBe(initialPixels.checksum);
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

test("region controls, search, inspector, and URL stay synchronized", async ({ page }) => {
  test.setTimeout(60_000);
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
  const overlayLayout = await page.evaluate(() => {
    const search = document
      .querySelector<HTMLElement>('[aria-label="Atlas search"]')!
      .getBoundingClientRect();
    const inspector = document
      .querySelector<HTMLElement>('aside')!
      .getBoundingClientRect();
    return {
      searchBottom: search.bottom,
      inspectorTop: inspector.top,
    };
  });
  expect(overlayLayout.searchBottom).toBeLessThanOrEqual(overlayLayout.inspectorTop);
  await expect(page.getByRole("region", { name: "Atlas search" })).toHaveAttribute(
    "data-state",
    "selected-result",
  );

  await page.getByRole("button", { name: "Clear selected region" }).click();
  await expect(page.getByRole("region", { name: "Atlas search" })).toHaveAttribute(
    "data-state",
    "grouped-results",
  );
});

test("globe supports pointer, wheel, touch, and keyboard exploration", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/#/atlas");
  const canvas = page.getByLabel("Interactive route globe");
  await expect(canvas).toHaveAttribute("data-heat-lines", "66");
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
  await expect(page).not.toHaveURL(/region=/);
  await expect.poll(() => textureResponses.length).toBeGreaterThan(0);
  expect(textureResponses[0].url).toContain("/assets/earth-atmos-2048.jpg");
  expect(textureResponses[0].status).toBe(200);
});

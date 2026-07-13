import { expect, test, type Page } from "@playwright/test";

async function canvasStats(page: Page) {
  return page.getByLabel("Interactive route globe").evaluate((canvas: HTMLCanvasElement) => {
    const gl =
      canvas.getContext("webgl2") ??
      canvas.getContext("webgl") ??
      canvas.getContext("experimental-webgl");
    if (!(gl instanceof WebGLRenderingContext || gl instanceof WebGL2RenderingContext)) {
      return { nonblank: 0, checksum: 0 };
    }
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let nonblank = 0;
    let checksum = 0;
    const stride = Math.max(4, Math.floor(pixels.length / 50_000 / 4) * 4);
    for (let index = 0; index < pixels.length; index += stride) {
      const value = pixels[index] + pixels[index + 1] + pixels[index + 2];
      if (value > 12) nonblank += 1;
      checksum = (checksum + value * (index + 1)) % 2_147_483_647;
    }
    return { nonblank, checksum };
  });
}

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`Atlas fills the available ${viewport.name} workspace with live pixels`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/#/atlas");
    const canvas = page.getByLabel("Interactive route globe");
    await expect(canvas).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(async () => (await canvasStats(page)).nonblank, { timeout: 15_000 })
      .toBeGreaterThan(500);

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
});

test("globe supports pointer, wheel, touch, and keyboard exploration", async ({ page }) => {
  await page.goto("/#/atlas");
  const canvas = page.getByLabel("Interactive route globe");
  await expect
    .poll(async () => (await canvasStats(page)).nonblank, { timeout: 15_000 })
    .toBeGreaterThan(500);
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) return;

  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 80, bounds.y + bounds.height / 2 + 30);
  await page.mouse.up();
  await canvas.dispatchEvent("wheel", { deltaY: -120 });
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

  await canvas.focus();
  const before = await canvasStats(page);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("+");
  await page.waitForTimeout(180);
  const after = await canvasStats(page);
  expect(after.nonblank).toBeGreaterThan(500);
  expect(after.checksum).not.toBe(before.checksum);
});

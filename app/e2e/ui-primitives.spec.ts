import { expect, test, type Locator, type Page } from "@playwright/test";

// Shared Button and Input primitives: a visible keyboard focus ring (UX-02),
// no iOS focus zoom on touch devices (UX-10), and 44 px Finder icon buttons
// on phones (UX-21). Assertions read computed geometry and styles, not pixels.

const ringColor = "rgb(245, 244, 241)"; // --ring on the black canvas

type Outline = { style: string; width: number; color: string; focusVisible: boolean };

function readOutline(locator: Locator): Promise<Outline> {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      style: style.outlineStyle,
      width: Number.parseFloat(style.outlineWidth),
      color: style.outlineColor,
      focusVisible: element.matches(":focus-visible"),
    };
  });
}

async function expectVisibleRing(focused: Locator) {
  // Buttons use `transition-all`, so width and colour settle after a frame or two.
  await expect.poll(() => readOutline(focused)).toEqual({
    style: "solid",
    width: 2,
    color: ringColor,
    focusVisible: true,
  });
}

async function tabTo(page: Page, selector: string, maxTabs = 60) {
  for (let index = 0; index < maxTabs; index += 1) {
    await page.keyboard.press("Tab");
    if (await page.evaluate((query) => document.activeElement?.matches(query) ?? false, selector)) {
      return page.locator(":focus");
    }
  }
  throw new Error(`Tab never reached ${selector}`);
}

async function fontSize(locator: Locator) {
  return locator.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
}

async function openAdminReadOnly(page: Page) {
  await page.route("http://127.0.0.1:8766/**", (route) => route.abort());
  await page.goto("/#/admin");
  const editor = page.getByRole("region", { name: "Route curation editor" });
  await expect(editor).toBeVisible();
  return editor;
}

test.describe("keyboard focus on shared primitives (desktop)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("every Button variant and size reached by Tab draws the ring", async ({ page }) => {
    await page.goto("/#/routes/14023448720");
    await expect(page.getByRole("button", { name: "Download GPX" })).toBeVisible();

    const seen = new Set<string>();
    for (let index = 0; index < 40; index += 1) {
      await page.keyboard.press("Tab");
      const focused = page.locator(':focus[data-slot="button"]');
      if ((await focused.count()) === 0) continue;
      const kind = `${await focused.evaluate((element) => element.tagName)}:${await focused.getAttribute("data-variant")}:${await focused.getAttribute("data-size")}`;
      if (seen.has(kind)) continue;
      seen.add(kind);
      await expectVisibleRing(focused);
    }
    // Ghost icon, ghost sm link, outline sm, default link, outline default.
    expect(seen.size).toBeGreaterThanOrEqual(4);
  });

  test("the Finder Input and Buttons draw the ring on keyboard focus", async ({ page }) => {
    await page.goto("/#/finder");
    await expect(page.getByRole("form", { name: "Find a route" })).toBeVisible();
    await expectVisibleRing(await tabTo(page, '[data-slot="input"]'));
    await expectVisibleRing(await tabTo(page, '[data-slot="button"]'));
  });

  test("a mouse click on a Button does not draw the ring", async ({ page }) => {
    await page.goto("/#/finder");
    const filters = page.getByRole("button", { name: "Edit filters" });
    await filters.click();
    await expect(page.getByRole("button", { name: "Hide filters" })).toBeFocused();
    expect(await readOutline(page.getByRole("button", { name: "Hide filters" }))).toMatchObject({
      style: "none",
      focusVisible: false,
    });
  });

  test("dense desktop keeps 14 px fields for a fine pointer", async ({ page }) => {
    await page.goto("/#/finder");
    expect(await fontSize(page.getByRole("textbox", { name: "Describe your next route" }))).toBe(14);
    const editor = await openAdminReadOnly(page);
    expect(await fontSize(editor.getByLabel("Vibe"))).toBe(14);
  });
});

for (const viewport of [
  { name: "phone landscape", width: 844, height: 390 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "phone", width: 390, height: 844 },
]) {
  test.describe(`touch fields on ${viewport.name}`, () => {
    test.use({
      viewport: { width: viewport.width, height: viewport.height },
      hasTouch: true,
      isMobile: true,
      deviceScaleFactor: 2,
    });

    test(`text fields compute to at least 16 px on ${viewport.name}`, async ({ page }) => {
      await page.goto("/#/finder");
      expect(
        await fontSize(page.getByRole("textbox", { name: "Describe your next route" })),
      ).toBeGreaterThanOrEqual(16);

      const editor = await openAdminReadOnly(page);
      for (const label of ["Vibe", "Ideal use", "Difficulty", "Highlights", "Editorial note"]) {
        expect(await fontSize(editor.getByLabel(label)), label).toBeGreaterThanOrEqual(16);
      }
    });
  });
}

test.describe("Finder icon buttons on phones", () => {
  test.use({
    viewport: { width: 320, height: 640 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });

  for (const width of [320, 390]) {
    test(`Find routes and Edit filters are at least 44x44 and named at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/#/finder");
      for (const name of ["Find routes", "Edit filters"]) {
        const button = page.getByRole("button", { name, exact: true });
        await expect(button).toBeVisible();
        const box = await button.boundingBox();
        expect(box, name).not.toBeNull();
        expect(box!.width, `${name} width`).toBeGreaterThanOrEqual(44);
        expect(box!.height, `${name} height`).toBeGreaterThanOrEqual(44);
      }
    });
  }
});

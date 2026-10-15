import { expect, test } from "@playwright/test";

test.skip(!process.env.GODIESEL_ATLAS_PREVIEW_URL, "Live Atlas is opt-in.");

for (const width of [390, 684, 1440]) {
  test(`Atlas keeps complete credits accessible at ${width}px`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    await page.goto(`${process.env.GODIESEL_ATLAS_PREVIEW_URL}/#/atlas?region=New+York%2C+NY`);
    await expect(page.locator('[data-atlas-engine="cesium"]').first())
      .toHaveAttribute("data-atlas-status", "region-ready", { timeout: 60_000 });
    const sources = page.getByRole("region", { name: "Map data sources", includeHidden: true });
    const toggle = page.getByRole("button", { name: "Data sources", exact: true });
    await expect(sources).toContainText("Google", { timeout: 15_000 });
    await expect(page.getByRole("link", { name: "Cesium ion" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    if (width < 1000) {
      await expect(sources).toBeHidden();
      await expect(page.getByText("Google Maps", { exact: true })).toBeVisible();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await page.screenshot({ path: `artifacts/atlas-attribution/compact-${width}.png` });
      const creditText = await sources.textContent();
      await toggle.click();
      await expect(sources).toBeVisible();
      expect(await sources.textContent()).toBe(creditText);
      const bounds = (await sources.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      await page.screenshot({ path: `artifacts/atlas-attribution/expanded-${width}.png` });
      await toggle.press("Escape");
      await expect(sources).toBeHidden();
      await expect(toggle).toBeFocused();
      await expect(page).toHaveURL(/region=New\+York/);
      await toggle.click();
      await page.getByRole("textbox", { name: "Search places and routes" }).click();
      await expect(sources).toBeHidden();
      await page.getByRole("textbox", { name: "Search places and routes" }).press("Escape");
      await page.getByRole("link", { name: "Return to global Atlas" }).click();
      await expect(toggle).toBeHidden();
      await expect(page.getByText("Google Maps", { exact: true })).toBeHidden();
    } else {
      await expect(toggle).toBeHidden();
      await expect(sources).toBeVisible();
      await page.screenshot({ path: "artifacts/atlas-attribution/desktop.png" });
    }
  });
}

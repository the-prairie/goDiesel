import { expect, test } from "@playwright/test";

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
  test(`Ember surfaces remain coherent and usable at ${viewport.width}px`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(viewport);
    for (const [name, path, heading] of [
      ["finder", "finder?place=Kyoto&activity=Run&distance=20", "Plan the next day."],
      ["routes", "routes", "Places worth returning to."],
      ["guide", "routes/17654151284", "🍑🍑🍑🍑💦💦💦💦"],
      ["replay", "replay/17654151284", "🍑🍑🍑🍑💦💦💦💦"],
    ]) {
      await page.goto(`${process.env.EMBER_PREVIEW_URL ?? ""}/#/${path}`);
      await expect(page.getByRole("heading", { name: heading, exact: true }).first()).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const nav = page.getByTestId(viewport.width < 768 ? "atlas-spine-mobile" : "atlas-spine");
      if (name === "replay") {
        await expect(nav).toBeHidden();
        await expect(page.getByRole("button", { name: "All routes", exact: true })).toBeVisible();
      } else await expect(nav).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
      await page.screenshot({ path: `artifacts/ember/${name}-${viewport.width}.png` });
    }
  });
}

for (const viewport of [{ width: 390, height: 844 }, { width: 390, height: 320 }, { width: 1280, height: 900 }]) {
  test(`Ember selected Atlas controls stay clear at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    await page.goto(`${process.env.EMBER_PREVIEW_URL ?? ""}/#/atlas?region=Kyoto%2C+Japan`);
    const tray = page.getByRole("region", { name: "Kyoto, Japan routes", exact: true });
    // Regional terrain may take up to eight seconds before its fallback is chosen.
    await expect(tray.getByRole("heading", { name: "Kyoto, Japan", exact: true, level: 2 })).toBeVisible({ timeout: 15_000 });
    const tools = (await page.getByRole("group", { name: "Map controls" }).boundingBox())!;
    const trayBox = (await tray.boundingBox())!;
    expect(trayBox.height).toBeLessThanOrEqual(viewport.height <= 400 ? 146 : 194);
    const search = (await page.getByRole("region", { name: "Atlas search" }).boundingBox())!;
    expect(tools.y + tools.height).toBeLessThanOrEqual(trayBox.y);
    expect(search.y + search.height).toBeLessThanOrEqual(trayBox.y);
    const selected = tray.locator('article[data-selected="true"]');
    await expect(selected.getByRole("link", { name: "Route guide" })).toBeVisible();
    await expect(selected.getByRole("link", { name: "Open replay" })).toBeVisible();
    if (process.env.EMBER_PREVIEW_URL) {
      const attribution = page.locator(".cesium-viewer-bottom");
      const attributionBox = (await attribution.boundingBox())!;
      expect(attributionBox.y + attributionBox.height).toBeLessThanOrEqual(trayBox.y + 1);
      for (const thumbnail of await tray.locator('[data-route-thumbnail]').all()) {
        await expect(thumbnail).toHaveAttribute("data-thumbnail-state", "loaded", { timeout: 15_000 });
        await expect(thumbnail.locator("img")).toHaveCSS("opacity", "1");
      }
    }
    await page.screenshot({ path: `artifacts/ember/atlas-${viewport.width}x${viewport.height}.png` });
  });
}

for (const width of [320, 390, 1280]) {
  test(`Ember Replay settings layout at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`${process.env.EMBER_PREVIEW_URL ?? ""}/#/replay/9844581410`);
    await page.getByRole("button", { name: "Replay settings", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "Replay settings" });
    await expect(panel).toBeVisible();
    const controls = panel.getByRole("button");
    for (const button of await controls.all()) {
      const box = (await button.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    await page.screenshot({ path: `artifacts/ember/replay-settings-${width}.png` });
  });
}

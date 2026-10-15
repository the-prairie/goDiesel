import { expect, test } from "@playwright/test";

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`dense globe labels stay stable and separated at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => {
      window.__GODIESEL_ATLAS_WORLD_FACTORY__ = () => {
        let container: HTMLElement;
        return {
          async mount(options) {
            container = options.container;
            options.onStatus({ state: "ready", message: "Ready" });
          },
          setSelectedRegion() {}, setSelectedRoute() {}, zoomIn() {}, zoomOut() {}, resetView() {}, destroy() {},
          projectRegions: () => [
            { name: "Crete, Greece", x: container.clientWidth / 2, y: 380, visible: true },
            { name: "Bologna, Italy", x: container.clientWidth / 2, y: 419, visible: true },
            { name: "London, UK", x: container.clientWidth / 2, y: 458, visible: true },
          ],
        };
      };
    });
    await page.goto("/#/atlas");
    const crete = page.getByRole("button", { name: "Select Crete, Greece on globe" });
    await expect(crete).toBeVisible();
    // Multiple frames catch the old display:none -> 130x28 -> visible ->
    // measured 44px -> hidden cycle, which a single screenshot misses.
    const samples = await page.evaluate(async () => {
      const frames: string[][] = [];
      for (let index = 0; index < 24; index++) {
        frames.push(Array.from(document.querySelectorAll<HTMLButtonElement>("[data-globe-region]"))
          .filter((label) => getComputedStyle(label).visibility === "visible" && label.offsetWidth > 0)
          .map((label) => label.dataset.globeRegion!));
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      return frames;
    });
    for (const sample of samples) expect(sample.sort()).toEqual(["Crete, Greece", "London, UK"]);
    const hidden = page.locator('[data-globe-region="Bologna, Italy"]');
    await expect(hidden).toBeHidden();
    expect(await hidden.evaluate((label) => (label as HTMLElement).offsetHeight)).toBeGreaterThanOrEqual(44);
    await crete.click();
    await expect(page).toHaveURL(/region=Crete/);
  });
}

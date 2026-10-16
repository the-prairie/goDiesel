import { expect, test } from "@playwright/test";

const liveEnabled = process.env.GODIESEL_LIVE_EARTH_E2E === "1";

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 390, height: 844 },
  { width: 320, height: 640 },
]) {
  test(`live Playable Earth keeps controls and attribution usable at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    test.skip(
      !liveEnabled,
      "Set GODIESEL_LIVE_EARTH_E2E=1 for real Cesium and Google tiles.",
    );
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    await page.goto("/#/lab/playable-earth/17654151284");
    const lab = page.getByRole("region", { name: "Playable Earth Lab" });
    await expect(lab).toHaveAttribute("data-state", "ready", {
      timeout: 60_000,
    });
    await page
      .getByRole("button", { name: "Take control", exact: true })
      .click();
    if (viewport.width < 768)
      await page.getByRole("button", { name: "Show more controls" }).click();
    await page.getByRole("button", { name: "Zoom in to route" }).click();
    await expect(lab).toHaveAttribute("data-camera-range", "240");
    const progress = page.getByRole("slider", { name: "Route progress" });
    await progress.fill("5000");
    await page.getByRole("button", { name: "Play route", exact: true }).click();
    await expect
      .poll(async () => Number(await progress.inputValue()))
      .toBeGreaterThan(5050);
    await page.getByRole("button", { name: "Pause route" }).click();
    await page.getByRole("button", { name: "Resume automatic replay" }).click();
    await expect(lab).toHaveAttribute("data-control-mode", "replay");
    const credits = page.locator(".cesium-widget-credits");
    await expect(credits).toContainText("Google", { timeout: 15_000 });
    const creditBox = await credits.boundingBox();
    const controlsBox = await page
      .getByTestId("playable-controls")
      .boundingBox();
    expect(creditBox).not.toBeNull();
    expect(controlsBox).not.toBeNull();
    expect(creditBox!.y + creditBox!.height).toBeLessThanOrEqual(
      controlsBox!.y,
    );
    await expect
      .poll(() =>
        page.getByRole("link", { name: "Cesium ion" }).evaluate((link) => {
          const box = link.getBoundingClientRect();
          return link.contains(
            document.elementFromPoint(
              box.x + box.width / 2,
              box.y + box.height / 2,
            ),
          );
        }),
      )
      .toBe(true);
    await testInfo.attach("live-playable-earth", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
    await page.getByRole("link", { name: "Exit lab" }).click();
    await expect(page).toHaveURL(/#\/routes\/17654151284$/);
  });
}

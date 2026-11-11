import { expect, test, type Locator, type Page } from "@playwright/test";

test.skip(process.env.GODIESEL_LIVE_GOOGLE_3D_E2E !== "1", "Requires live Google imagery.");

async function openReplay(page: Page, slug = "14736711660") {
  await page.goto(`/#/replay/${slug}`);
  await expect(page.getByTestId("replay-stage")).toHaveAttribute("data-state", "ready", { timeout: 45_000 });
}

async function press(page: Page, locator: Locator) {
  if (page.viewportSize()!.width === 390) await locator.tap();
  else await locator.click();
}

async function framing(page: Page) {
  const marker = page.getByTestId("replay-position-marker");
  await expect(marker).toBeVisible();
  const point = (await marker.boundingBox())!;
  const header = (await page.locator(".replay-header").boundingBox())!;
  const dock = (await page.locator(".immersive-replay-dock").boundingBox())!;
  expect(point.x).toBeGreaterThan(12);
  expect(point.x + point.width).toBeLessThan(page.viewportSize()!.width - 12);
  expect(point.y).toBeGreaterThan(header.y + header.height);
  expect(point.y + point.height).toBeLessThan(dock.y);
}

const camera = (page: Page) => page.locator("gmp-map-3d").evaluate(element => {
  const map = element as google.maps.maps3d.Map3DElement;
  return { range: map.range!, heading: map.heading!, tilt: map.tilt! };
});

for (const width of [1440, 390]) {
  test.describe(`sustained shot at ${width}`, () => {
    test.use({ viewport: { width, height: width === 390 ? 844 : 1000 }, isMobile: width === 390, hasTouch: width === 390 });
    test.setTimeout(120_000);

    test("immediate entry, pause, 4x playback, and every camera mode remain usable", async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await openReplay(page);
      const stage = page.getByTestId("replay-stage");
      await expect(stage).toHaveAttribute("data-camera-entrance", "tracking");
      const initial = await camera(page);
      expect(initial.range).toBeCloseTo(width === 390 ? 620 : 540, 0);
      await press(page, page.getByRole("button", { name: "Play route", exact: true }));
      await page.waitForTimeout(3000);
      await press(page, page.getByRole("button", { name: "Pause route", exact: true }));
      const slider = page.getByLabel("Route progress", { exact: true });
      const paused = await slider.inputValue();
      await page.waitForTimeout(700);
      await expect(slider).toHaveValue(paused);
      await press(page, page.getByRole("button", { name: "Playback speed 1x", exact: true }));
      await press(page, page.getByRole("button", { name: "Playback speed 2x", exact: true }));
      await press(page, page.getByRole("button", { name: "Play route", exact: true }));
      await page.waitForTimeout(14_000);
      await press(page, page.getByRole("button", { name: "Pause route", exact: true }));
      await page.waitForTimeout(1500);
      await framing(page);
      expect((await camera(page)).range).toBeCloseTo(initial.range, 0);
      await press(page, page.getByRole("button", { name: "Replay settings", exact: true }));
      const dialog = page.getByRole("dialog", { name: "Replay settings" });
      for (const [name, mode] of [["Runner", "runner"], ["Chase", "chase"], ["Overview", "overview"], ["Auto director", "auto"]]) {
        await press(page, dialog.getByRole("button", { name, exact: true }));
        await expect(stage).toHaveAttribute("data-camera-mode", mode);
      }
      await press(page, dialog.getByRole("button", { name: "Explore freely", exact: true }));
      await expect(stage).toHaveAttribute("data-following", "false");
      await press(page, dialog.getByRole("button", { name: "Follow route", exact: true }));
      await expect(stage).toHaveAttribute("data-following", "true");
      await press(page, dialog.getByRole("button", { name: "Close", exact: true }));
      await page.waitForTimeout(8000);
      await framing(page);
      await page.screenshot({ path: `artifacts/replay-sustained/controls-${width}.png` });
      expect(errors).toEqual([]);
    });

    test("scrubbing, manual exploration, and the end of the authored shot preserve control", async ({ page }) => {
      await openReplay(page);
      const slider = page.getByLabel("Route progress", { exact: true });
      const box = (await slider.boundingBox())!;
      if (width === 390) await page.touchscreen.tap(box.x + box.width * .06, box.y + box.height * .5);
      else await slider.click({ position: { x: box.width * .06, y: box.height * .5 } });
      expect(Number(await slider.inputValue())).toBeGreaterThan(1000);
      await slider.fill("1850");
      await page.waitForTimeout(9000);
      await press(page, page.getByRole("button", { name: "Play route", exact: true }));
      await page.waitForTimeout(15_000);
      await press(page, page.getByRole("button", { name: "Pause route", exact: true }));
      expect(Number(await slider.inputValue())).toBeGreaterThan(2200);
      await page.waitForTimeout(3000);
      await framing(page);
      if (width === 390) {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 150, y: 340 }] });
        for (let i = 1; i <= 8; i++) {
          await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 150 + i * 10, y: 340 + i * 3 }] });
        }
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await cdp.detach();
      } else {
        await page.mouse.move(500, 340);
        await page.mouse.down();
        await page.mouse.move(650, 380, { steps: 8 });
        await page.mouse.up();
      }
      await expect(page.getByTestId("replay-stage")).toHaveAttribute("data-following", "false");
      await press(page, page.getByRole("button", { name: "Replay settings", exact: true }));
      const dialog = page.getByRole("dialog", { name: "Replay settings" });
      await press(page, dialog.getByRole("button", { name: "Follow route", exact: true }));
      await press(page, dialog.getByRole("button", { name: "Close", exact: true }));
      await page.waitForTimeout(9000);
      await framing(page);
      await page.screenshot({ path: `artifacts/replay-sustained/handoff-${width}.png` });
    });

    test("reduced motion and route replacement keep defaults intact", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await openReplay(page);
      const stage = page.getByTestId("replay-stage");
      await expect(stage).toHaveAttribute("data-camera-entrance", "tracking");
      const slider = page.getByLabel("Route progress", { exact: true });
      await slider.fill("900");
      await framing(page);
      await press(page, page.getByRole("button", { name: "Play route", exact: true }));
      await page.waitForTimeout(3000);
      await press(page, page.getByRole("button", { name: "Pause route", exact: true }));
      await press(page, page.getByRole("button", { name: "Change route", exact: true }));
      await page.getByPlaceholder("Search place or activity").fill("dogs");
      await press(page, page.getByRole("link", { name: /who let the dogs out/ }));
      await expect(stage).toHaveAttribute("data-route-slug", "9953403673");
      await expect(stage).toHaveAttribute("data-state", "ready", { timeout: 45_000 });
      await expect(slider).toHaveValue("0");
      await framing(page);
      await page.screenshot({ path: `artifacts/replay-sustained/bali-${width}.png` });
      await openReplay(page, "14023448720");
      await framing(page);
      await press(page, page.getByRole("button", { name: "Play route", exact: true }));
      await page.waitForTimeout(3000);
      await press(page, page.getByRole("button", { name: "Pause route", exact: true }));
      await framing(page);
      await page.screenshot({ path: `artifacts/replay-sustained/crete-${width}.png` });
    });
  });
}

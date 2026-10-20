import { expect, test, type Page } from "@playwright/test";
import { installGoogleReplay } from "./helpers/google-replay";

async function openMoments(page: Page) {
  await page.getByRole("button", { name: "Browse chapters and moments", exact: true }).click();
  await expect(page.getByTestId("replay-chapter-browser")).toBeVisible();
}

async function highPoint(page: Page) {
  await page.getByRole("button", { name: /high point/i }).click();
  await expect(page.getByRole("button", { name: "Play from here", exact: true })).toBeVisible();
}

for (const width of [390, 1440]) {
  test(`moment preview pauses without seeking and cancel preserves the route at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await installGoogleReplay(page, "ready");
    await page.goto("/#/replay/14736711660");
    const progress = page.getByRole("slider", { name: "Route progress", exact: true });
    await progress.fill("3000");
    await page.getByRole("button", { name: "Play route", exact: true }).click();
    await openMoments(page);
    await highPoint(page);
    const paused = await progress.inputValue();
    expect(Number(paused)).toBeGreaterThanOrEqual(3000);
    expect(Number(paused)).toBeLessThan(3100);
    const preview = page.getByRole("slider", { name: "Chapter preview position", exact: true });
    const minimum = Number(await preview.getAttribute("min"));
    const maximum = Number(await preview.getAttribute("max"));
    await preview.fill(String(Math.round((minimum + maximum) / 2)));
    await expect(progress).toHaveValue(paused);
    await page.getByRole("button", { name: "Back to replay", exact: true }).click();
    await expect(progress).toHaveValue(paused);
    await expect(page.getByRole("button", { name: "Play route", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Play from here", exact: true })).toBeHidden();
  });

  test(`preview commit plays its selected position and route switching resets it at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await installGoogleReplay(page, "ready");
    await page.goto("/#/replay/14736711660");
    const progress = page.getByRole("slider", { name: "Route progress", exact: true });
    await progress.fill("1000");
    await openMoments(page);
    await highPoint(page);
    const preview = page.getByRole("slider", { name: "Chapter preview position", exact: true });
    const selected = Number(await preview.inputValue());
    await page.getByRole("button", { name: "Play from here", exact: true }).click();
    await expect(page.getByRole("button", { name: "Pause route", exact: true })).toBeVisible();
    await expect.poll(async () => Number(await progress.inputValue())).toBeGreaterThan(selected);
    expect(Number(await progress.inputValue())).toBeLessThan(selected + 100);
    await page.getByRole("button", { name: "Pause route", exact: true }).click();
    await highPoint(page);
    await page.getByRole("button", { name: "Change route", exact: true }).click();
    const picker = page.getByRole("dialog", { name: "Choose a replay route" });
    await picker.getByRole("searchbox").fill("Tokyo");
    await picker.locator('a[href="#/replay/17665674778"]').click();
    await expect(progress).toHaveValue("0");
    await expect(page.getByRole("button", { name: "Play from here", exact: true })).toBeHidden();
    await expect(page.getByRole("button", { name: "Play route", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Browse chapters and moments", exact: true })).toBeVisible();
  });
}

test("keyboard playback and full-route seek leave preview cleanly", async ({ page }) => {
  await installGoogleReplay(page, "ready");
  await page.goto("/#/replay/14736711660");
  const progress = page.getByRole("slider", { name: "Route progress", exact: true });
  await progress.fill("5000");
  await openMoments(page);
  await highPoint(page);
  await page.locator('canvas[data-renderer="google-production"]').click({ position: { x: 100, y: 120 } });
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Pause route", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Play from here", exact: true })).toBeHidden();
  await expect.poll(async () => Number(await progress.inputValue())).toBeGreaterThan(5000);
  await highPoint(page);
  await progress.fill("2000");
  await expect(page.getByRole("button", { name: "Play from here", exact: true })).toBeHidden();
  await expect(progress).toHaveValue("2000");
});

test("provider loss cannot commit a preview or move its paused session", async ({ page }) => {
  await installGoogleReplay(page, "ready");
  await page.goto("/#/replay/14736711660");
  const progress = page.getByRole("slider", { name: "Route progress", exact: true });
  await progress.fill("5000");
  await openMoments(page);
  await highPoint(page);
  await page.evaluate(() => {
    (window as unknown as { __GODIESEL_SET_PROVIDER_STATUS__: (state: string) => void }).__GODIESEL_SET_PROVIDER_STATUS__("loading");
  });
  await expect(page.getByRole("button", { name: "Play from here", exact: true })).toBeDisabled();
  await expect(progress).toHaveValue("5000");
});

for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1440, height: 900 }]) {
  test(`chapter controls remain reachable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await installGoogleReplay(page, "ready");
    await page.goto("/#/replay/14736711660");
    await openMoments(page);
    await highPoint(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    for (const name of ["Collapse chapter browser", "Back to replay", "Play from here"]) {
      const button = page.getByRole("button", { name, exact: true });
      await button.scrollIntoViewIfNeeded();
      const box = (await button.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    }
    await page.screenshot({ path: `artifacts/replay-chapter-moments/fixture-preview-${viewport.width}.png` });
    await page.getByRole("button", { name: "Back to replay", exact: true }).click();
    await page.getByRole("button", { name: "Collapse chapter browser", exact: true }).click();
    await page.getByRole("button", { name: "Play route", exact: true }).click();
    await expect(page.getByRole("button", { name: "Pause route", exact: true })).toBeVisible();
  });
}

test("chapter and moment lenses use source distances and explain their origin", async ({ page }) => {
  await installGoogleReplay(page, "ready");
  await page.goto("/#/replay/14736711660");
  const progress = page.getByRole("slider", { name: "Route progress", exact: true });
  await progress.fill("1000");
  const data = await (await page.request.get("/data/routes/14736711660.json")).json();
  const highest = data.route.reduce((best: { d: number; elev: number }, point: { d: number; elev: number }) => point.elev > best.elev ? point : best);
  await openMoments(page);
  await page.getByTestId("replay-chapter-2").click();
  const preview = page.getByRole("slider", { name: "Chapter preview position", exact: true });
  expect(Number(await preview.inputValue())).toBeCloseTo(Number(await progress.getAttribute("max")) / 4, 2);
  await highPoint(page);
  expect(Number(await preview.inputValue())).toBeCloseTo(highest.d, 3);
  await page.getByRole("button", { name: "Why this moment?", exact: true }).click();
  await expect(page.getByText(/Highest recorded sample is/)).toContainText(`${highest.elev.toFixed(1)} m`);
  await page.getByRole("button", { name: "Inspect elevation profile", exact: true }).click();
  await expect(page.getByTestId("replay-chapter-lens")).toHaveAttribute("data-presentation", "profile");
  await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  await expect(preview).toHaveAttribute("min", "0");
  expect(Number(await preview.getAttribute("max"))).toBe(Number(await progress.getAttribute("max")));
  await preview.fill("2000");
  await expect(progress).toHaveValue("1000");
  await page.getByRole("button", { name: "Focus lens", exact: true }).click();
  expect(Number(await preview.inputValue())).toBeGreaterThanOrEqual(Number(await preview.getAttribute("min")));
  await page.getByRole("button", { name: "Back to replay", exact: true }).click();
  await expect(progress).toHaveValue("1000");
});

for (const width of [320, 1440]) {
  test(`clicks on the painted profile select its distance at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await installGoogleReplay(page, "ready");
    await page.goto("/#/replay/14736711660");
    await openMoments(page);
    await page.getByTestId("replay-chapter-2").click();
    for (const presentation of ["relief", "profile"]) {
      if (presentation === "profile") await page.getByRole("button", { name: "Inspect elevation profile", exact: true }).click();
      const lens = page.getByTestId("replay-chapter-lens");
      const input = page.getByRole("slider", { name: "Chapter preview position", exact: true });
      for (const ratio of [0.001, 0.5, 0.999]) {
        const min = Number(await input.getAttribute("min"));
        const max = Number(await input.getAttribute("max"));
        await lens.scrollIntoViewIfNeeded();
        const target = await lens.locator(".replay-chapter-edge").first().evaluate((element, ratio) => {
          const path = element as SVGPathElement;
          const length = path.getTotalLength();
          const start = path.getPointAtLength(0);
          const end = path.getPointAtLength(length);
          const x = start.x + (end.x - start.x) * ratio;
          let low = 0;
          let high = length;
          for (let i = 0; i < 30; i++) {
            const mid = (low + high) / 2;
            if (path.getPointAtLength(mid).x < x) low = mid;
            else high = mid;
          }
          const point = path.getPointAtLength((low + high) / 2);
          const screen = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM()!);
          return { x: screen.x, y: screen.y };
        }, ratio);
        await page.mouse.click(target.x, target.y);
        const box = (await input.boundingBox())!;
        expect(Math.abs(Number(await input.inputValue()) - (min + (max - min) * ratio))).toBeLessThan((max - min) / box.width * 1.5);
      }
    }
  });
}

test("the fallback action remains clickable above the expanded phone controls", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await installGoogleReplay(page, "ready");
  await page.goto("/#/replay/14736711660");
  await openMoments(page);
  await highPoint(page);
  await page.evaluate(() => {
    (window as unknown as { __GODIESEL_SET_PROVIDER_STATUS__: (state: string) => void }).__GODIESEL_SET_PROVIDER_STATUS__("unavailable");
  });
  await page.getByRole("button", { name: "Use Atlas replay", exact: true }).click();
  await expect(page.getByTestId("replay-stage")).toHaveAttribute("data-engine", "maplibre-atlas");
});

import { expect, test } from "@playwright/test";

test.skip(process.env.GODIESEL_CHAPTER_MOMENTS_LIVE !== "1", "Requires the deployed or local live replay.");

for (const width of [1440, 390]) {
  for (const slug of ["14736711660", "9953403673", "14023448720"]) {
    test(`live chapters and moments for ${slug} at ${width}px`, async ({ browser }) => {
      test.setTimeout(100_000);
      const context = await browser.newContext({
        viewport: { width, height: width === 390 ? 844 : 1000 },
        isMobile: width === 390,
        hasTouch: width === 390,
        baseURL: process.env.GODIESEL_ATLAS_PREVIEW_URL ?? "http://127.0.0.1:8823",
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      try {
        await page.goto(`/#/replay/${slug}`);
        await expect(page.getByTestId("replay-stage")).toHaveAttribute("data-state", "ready", { timeout: 60_000 });
        const progress = page.getByRole("slider", { name: "Route progress", exact: true });
        await progress.fill("1000");
        await page.getByRole("button", { name: "Play route", exact: true }).click();
        await expect.poll(async () => Number(await progress.inputValue())).toBeGreaterThan(1000);
        await page.getByRole("button", { name: "Pause route", exact: true }).click();
        await progress.fill("5000");
        await page.waitForTimeout(2200);
        const phase = process.env.GODIESEL_CHAPTER_EVIDENCE_PREFIX ?? "local";
        await page.screenshot({ path: `artifacts/replay-chapter-moments/${phase}-${slug}-${width}-compact.png` });
        await page.getByRole("button", { name: "Browse chapters and moments", exact: true }).click();
        await page.getByRole("button", { name: /high point/i }).click();
        await expect(progress).toHaveValue("5000");
        const preview = page.getByRole("slider", { name: "Chapter preview position", exact: true });
        await preview.press("ArrowRight");
        await expect(progress).toHaveValue("5000");
        await page.screenshot({ path: `artifacts/replay-chapter-moments/${phase}-${slug}-${width}-moment.png` });
        await page.getByRole("button", { name: "Back to replay", exact: true }).click();
        await expect(progress).toHaveValue("5000");
        await page.getByRole("button", { name: /high point/i }).click();
        const anchor = Number(await preview.inputValue());
        await page.getByRole("button", { name: "Play from here", exact: true }).click();
        await expect(page.getByRole("button", { name: "Pause route", exact: true })).toBeVisible();
        await expect.poll(async () => Number(await progress.inputValue())).toBeGreaterThan(anchor);
        await page.getByRole("button", { name: "Pause route", exact: true }).click();
        await page.getByRole("button", { name: "Collapse chapter browser", exact: true }).click();
        await page.getByRole("button", { name: "Playback speed 1x", exact: true }).click();
        await expect(page.getByRole("button", { name: "Playback speed 2x", exact: true })).toBeVisible();
        await page.getByRole("button", { name: "Replay settings", exact: true }).click();
        const settings = page.getByRole("dialog", { name: "Replay settings" });
        await settings.getByRole("button", { name: "Overview", exact: true }).click();
        await expect(page.getByTestId("replay-stage")).toHaveAttribute("data-camera-mode", "overview");
        await settings.getByRole("button", { name: "Auto director", exact: true }).click();
        await page.keyboard.press("Escape");
        await expect(settings).toBeHidden();
        await page.getByRole("button", { name: "Change route", exact: true }).click();
        const picker = page.getByRole("dialog", { name: "Choose a replay route" });
        await expect(picker).toBeVisible();
        await page.keyboard.press("Escape");
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        expect(errors).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }
}

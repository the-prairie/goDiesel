import { expect, test } from "@playwright/test";
import { installGoogleReplay } from "./helpers/google-replay";

for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1440, height: 1000 }]) {
  test(`compact dock preserves map space and reversible inspection at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await installGoogleReplay(page, "ready");
    await page.goto("/#/replay/14736711660");
    const dock = page.getByTestId("replay-controls");
    const progress = page.getByRole("slider", { name: "Route progress", exact: true });
    await progress.fill("6500");
    const box = (await dock.boundingBox())!;
    expect(box.height).toBeLessThan(160);
    expect(box.width).toBeLessThanOrEqual(640);
    await expect(page.getByTestId("replay-chapter-lens")).toHaveCount(0);
    await expect(page.getByText("Google 3D Replay", { exact: true })).toHaveCount(0);
    await expect(dock.getByText("Grade", { exact: true })).toHaveCount(0);
    const data = dock.getByRole("button", { name: "Data", exact: true });
    await data.click();
    await expect(dock.getByText("Grade", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Replay settings", exact: true }).click();
    await expect(dock).toBeHidden();
    await page.getByRole("dialog").getByRole("button", { name: "Runner", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(dock).toBeVisible();
    await expect(data).toHaveAttribute("aria-expanded", "true");
    await expect(progress).toHaveValue("6500");
    await data.click();
    await page.getByRole("button", { name: "Browse chapters and moments", exact: true }).click();
    await page.getByRole("button", { name: "Preview high point", exact: true }).click();
    const lens = page.getByTestId("replay-chapter-lens");
    await lens.scrollIntoViewIfNeeded();
    for (const marker of [lens.locator(".replay-chapter-preview-pin"), dock.locator(".replay-chapter-context .replay-chapter-pin")]) {
      const bounds = (await marker.boundingBox())!;
      expect(bounds.width).toBeGreaterThanOrEqual(9);
      expect(Math.abs(bounds.width - bounds.height)).toBeLessThan(.1);
    }
    await page.getByRole("button", { name: "Collapse chapter browser", exact: true }).click();
    await expect(progress).toHaveValue("6500");
    await expect(page.getByRole("button", { name: "Play from here", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Browse chapters and moments", exact: true }).click();
    await expect(page.getByRole("slider", { name: "Chapter preview position", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Back to replay", exact: true }).click();
    await page.getByRole("button", { name: "Collapse chapter browser", exact: true }).click();
    await page.getByRole("button", { name: "Play route", exact: true }).click();
    await expect.poll(async () => Number(await progress.inputValue())).toBeGreaterThan(6500);
    await page.getByRole("button", { name: "Pause route", exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
  });
}

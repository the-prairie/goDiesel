import { expect, test } from "@playwright/test";
import { installGoogleReplay } from "./helpers/google-replay";

for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
  test(`place stories preserve preview and use the app design at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await installGoogleReplay(page, "ready");
    await page.goto("/#/replay/14736711660");
    const controls = page.getByTestId("google-route-controls");
    const progress = page.getByRole("slider", { name: "Route progress", exact: true });
    await expect(controls).toContainText("Polk Gulch to Presidio Heights");
    const styles = await controls.evaluate(element => {
      const css = getComputedStyle(element);
      const root = getComputedStyle(document.documentElement);
      return { surface: css.backgroundColor, font: css.fontFamily, ink: css.color,
        token: root.getPropertyValue("--surface-map-glass").trim(),
        play: getComputedStyle(element.querySelector(".replay-chapter-play")!).backgroundColor,
        heading: getComputedStyle(element.querySelector(".replay-chapter-current")!).fontFamily };
    });
    expect(styles.surface).toBe("rgba(0, 0, 0, 0.72)");
    expect(styles.ink).toBe("rgb(255, 255, 255)");
    expect(styles.play).toBe("rgb(52, 55, 85)");
    expect(styles.font).toContain("Inter");
    expect(styles.heading).toContain("Inter");
    await progress.fill("3000");
    await page.getByRole("button", { name: "Browse chapters and moments" }).click();
    await expect(page.getByRole("group", { name: "Preview a chapter" }).getByRole("button")).toHaveCount(6);
    await page.getByRole("button", { name: "Preview chapter 4, Across Golden Gate Park", exact: true }).click();
    await expect(page.getByTestId("replay-chapter-story")).toContainText("Conservatory of Flowers");
    await page.getByText("Places along this chapter", { exact: true }).click();
    const source = page.getByRole("link", { name: "Map source for Japanese Tea Garden", exact: true });
    await expect(source).toHaveAttribute("href", "https://www.openstreetmap.org/way/30900516");
    await expect(source).toHaveAttribute("rel", "noreferrer");
    await page.getByRole("button", { name: "Preview near Japanese Tea Garden", exact: true }).click();
    await expect(progress).toHaveValue("3000");
    const preview = page.getByRole("slider", { name: "Chapter preview position", exact: true });
    const selected = Number(await preview.inputValue());
    expect(selected).toBeGreaterThan(19_200);
    expect(selected).toBeLessThan(19_300);
    await expect(page.getByRole("button", { name: "Play from here", exact: true })).toBeInViewport();
    await page.screenshot({ path: `artifacts/replay-place-stories/story-${viewport.width}.png` });
    await page.getByRole("button", { name: "Back to replay", exact: true }).click();
    await expect(progress).toHaveValue("3000");
    await page.getByRole("button", { name: "Preview chapter 6, Finish at Fisherman's Wharf", exact: true }).click();
    await page.getByRole("button", { name: "Play from here", exact: true }).click();
    await expect(page.getByRole("button", { name: "Pause route", exact: true })).toBeVisible();
    await expect.poll(async () => Number(await progress.inputValue())).toBeGreaterThan(25_800);
    await page.getByRole("button", { name: "Pause route", exact: true }).click();
    await page.getByRole("button", { name: "Collapse chapter browser", exact: true }).click();
    await page.screenshot({ path: `artifacts/replay-place-stories/compact-${viewport.width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("unreviewed routes keep neutral chapters and cannot inherit San Francisco places", async ({ page }) => {
  await installGoogleReplay(page, "ready");
  for (const slug of ["9953403673", "14023448720"]) {
    await page.goto(`/#/replay/${slug}`);
    await page.getByRole("button", { name: "Browse chapters and moments" }).click();
    await expect(page.getByRole("group", { name: "Preview a chapter" }).getByRole("button")).toHaveCount(4);
    await expect(page.getByTestId("replay-chapter-story")).toBeHidden();
    await expect(page.getByText("Chapters divide route distance.", { exact: false })).toBeVisible();
  }
});

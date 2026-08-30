import { expect, test } from "@playwright/test";

// Kyoto. Two frames from real iPhone videos shot during the run become
// source-ordered chapters in the Daydream field story.
const ROUTE = "17654151284";

test("photographs appear in route-story order", async ({ page }) => {
  await page.goto(`/#/routes/${ROUTE}`);

  const chapters = page.locator('[data-testid="route-story-chapter"]:has([data-testid="route-story-chapter-media"])');
  await expect(chapters).toHaveCount(2);

  const distances = await chapters.evaluateAll((nodes) =>
    nodes.map((node) => Number(node.getAttribute("data-at-distance-m"))),
  );
  expect(distances).toEqual([...distances].sort((a, b) => a - b));
});

test("every photographed chapter is named and keyboard reachable", async ({ page }) => {
  await page.goto(`/#/routes/${ROUTE}`);

  const images = page.getByTestId("route-story-chapter-media");
  await expect(images).toHaveCount(2);
  for (const image of await images.all()) {
    await expect(image).toHaveAttribute("alt", /\S+/);
  }

  const chapterButtons = page.getByRole("navigation", { name: "Story chapters" }).getByRole("button");
  for (const button of await chapterButtons.all()) {
    const box = await button.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  await chapterButtons.first().focus();
  await expect(chapterButtons.first()).toBeFocused();
});

test("reduced motion removes smooth story scrolling", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`/#/routes/${ROUTE}`);

  const story = page.getByRole("region", { name: "Route story", exact: true });
  await expect(story).toBeVisible();
  expect(await story.evaluate((node) => getComputedStyle(node).scrollBehavior)).toBe("auto");
});

test("the photographed chapter order is stable across reloads", async ({ page }) => {
  const read = async () => {
    await page.goto(`/#/routes/${ROUTE}`);
    await page.getByTestId("route-story-chapter-media").first().waitFor();
    return page.getByTestId("route-story-chapter-media").evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("src")),
    );
  };
  expect(await read()).toEqual(await read());
});

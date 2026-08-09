import { expect, test } from "@playwright/test";

// Kyoto. Two frames from real iPhone videos shot during the run, placed at
// 7.57 km and 8.63 km.
const ROUTE = "17654151284";

test("photographs fan out in route order", async ({ page }) => {
  await page.goto(`/#/routes/${ROUTE}`);

  const fan = page.getByTestId("polaroid-fan");
  await expect(fan).toBeVisible();

  const cards = page.getByTestId("polaroid-card");
  await expect(cards).toHaveCount(2);

  const distances = await cards.evaluateAll((nodes) =>
    nodes.map((node) => Number(node.getAttribute("data-at-distance-m"))),
  );
  expect(distances).toEqual([...distances].sort((a, b) => a - b));

  // Left to right is earliest to latest.
  const boxes = await cards.evaluateAll((nodes) =>
    nodes.map((node) => node.getBoundingClientRect().x),
  );
  expect(boxes[0]).toBeLessThan(boxes[1]);
});

test("every card is reachable and names its place on the route", async ({ page }) => {
  await page.goto(`/#/routes/${ROUTE}`);

  const cards = page.getByTestId("polaroid-card");
  for (const card of await cards.all()) {
    await expect(card).toHaveAttribute("aria-label", /Photograph \d+ of \d+, at .+/);
    const box = await card.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  await cards.first().focus();
  await expect(cards.first()).toBeFocused();
});

test("reduced motion lays the photographs flat", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`/#/routes/${ROUTE}`);

  const fan = page.getByTestId("polaroid-fan");
  await expect(fan).toHaveAttribute("data-layout", "grid");

  const rotated = await page.getByTestId("polaroid-card").evaluateAll((nodes) =>
    nodes.filter((node) => {
      const transform = getComputedStyle(node).transform;
      return transform !== "none" && !transform.startsWith("matrix(1, 0, 0, 1");
    }).length,
  );
  expect(rotated).toBe(0);
});

test("the fan is stable across reloads", async ({ page }) => {
  const read = async () => {
    await page.goto(`/#/routes/${ROUTE}`);
    await page.getByTestId("polaroid-fan").waitFor();
    return page.getByTestId("polaroid-card").evaluateAll((nodes) =>
      nodes.map((node) => getComputedStyle(node).transform),
    );
  };
  expect(await read()).toEqual(await read());
});

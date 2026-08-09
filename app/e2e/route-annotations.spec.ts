import { expect, test } from "@playwright/test";

// The Appian Way is the imported, scouted route and the only one with
// annotations today.
const ROUTE = "3519505225411091950";

test("route annotations appear in the margin, in route order", async ({ page }) => {
  await page.goto(`/#/routes/${ROUTE}`);

  const list = page.getByTestId("route-annotations");
  await expect(list).toBeVisible();

  const items = page.getByTestId("route-annotation");
  await expect(items).toHaveCount(3);

  const distances = await items.evaluateAll((nodes) =>
    nodes.map((node) => Number(node.getAttribute("data-at-distance-m"))),
  );
  expect(distances).toEqual([...distances].sort((a, b) => a - b));

  await expect(items.first()).toContainText("Circus Maximus");
  await expect(items.nth(1)).toContainText("Historic cobbles");
});

test("an editorial annotation is marked, never presented as recorded", async ({
  page,
}) => {
  await page.goto(`/#/routes/${ROUTE}`);

  const editorial = page.locator('[data-testid="route-annotation"][data-evidence="hypothesis"]');
  await expect(editorial).toHaveCount(3);
  for (const item of await editorial.all()) {
    await expect(item).toContainText("Editorial");
  }
});

test("a route without annotations shows no annotation section", async ({ page }) => {
  await page.goto("/#/routes/17665674778");
  await expect(page.getByTestId("route-annotations")).toHaveCount(0);
});

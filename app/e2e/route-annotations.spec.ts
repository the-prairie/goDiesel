import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// The Appian Way is the imported, scouted route.
const ROUTE = "3519505225411091950";

/**
 * Read the annotations the route actually ships with.
 *
 * A hardcoded count broke as soon as a fourth annotation was authored, which is
 * ordinary curation rather than a regression. What matters is that every
 * annotation renders, in route order, with its evidence marked.
 */
const annotations = (
  JSON.parse(
    fs.readFileSync(
      path.resolve(process.cwd(), `public/data/routes/${ROUTE}.json`),
      "utf8",
    ),
  ) as {
    annotations?: Array<{
      kind: string;
      evidence: string;
      title?: string;
      at_distance_m: number;
    }>;
  }
).annotations ?? [];

const written = annotations.filter((item) => item.kind !== "image");
const editorial = written.filter((item) => item.evidence === "hypothesis");

test("route annotations appear in the margin, in route order", async ({ page }) => {
  await page.goto(`/#/routes/${ROUTE}`);

  const list = page.getByTestId("route-annotations");
  await expect(list).toBeVisible();

  const items = page.getByTestId("route-annotation");
  await expect(items).toHaveCount(written.length);

  const distances = await items.evaluateAll((nodes) =>
    nodes.map((node) => Number(node.getAttribute("data-at-distance-m"))),
  );
  expect(distances).toEqual([...distances].sort((a, b) => a - b));

  // The rendered order must match the recorded order, whatever has been
  // authored. Naming specific titles made this assert the author's memory
  // rather than the contract.
  const expectedOrder = [...written].sort(
    (left, right) => left.at_distance_m - right.at_distance_m,
  );
  expect(distances).toEqual(expectedOrder.map((item) => item.at_distance_m));
  for (const [index, item] of expectedOrder.entries()) {
    if (item.title) await expect(items.nth(index)).toContainText(item.title);
  }
});

test("an editorial annotation is marked, never presented as recorded", async ({
  page,
}) => {
  await page.goto(`/#/routes/${ROUTE}`);

  const marked = page.locator('[data-testid="route-annotation"][data-evidence="hypothesis"]');
  await expect(marked).toHaveCount(editorial.length);
  for (const item of await marked.all()) {
    await expect(item).toContainText("Editorial");
  }
});

test("a route without annotations shows no annotation section", async ({ page }) => {
  await page.goto("/#/routes/17665674778");
  await expect(page.getByTestId("route-annotations")).toHaveCount(0);
});

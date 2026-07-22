import { expect, test } from "@playwright/test";

test("compares the San Francisco and Crete route genomes", async ({ page }) => {
  await page.goto("/#/lab/route-intelligence");

  await expect(page.getByTestId("route-intelligence-lab")).toBeVisible();
  await expect(page.getByTestId("route-genome-14736711660")).toContainText(
    "San Francisco",
  );
  await expect(page.getByTestId("route-genome-14023448720")).toContainText(
    "Crete, Greece",
  );
  await expect(page.getByText("Satellite observed")).toHaveCount(2);
  await expect(page.getByTestId("satellite-ribbon-14736711660")).toBeVisible();
  await expect(page.getByTestId("satellite-ribbon-14023448720")).toBeVisible();

  await page.getByRole("button", { name: "Crete" }).click();
  await expect(page.getByRole("button", { name: "Crete" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

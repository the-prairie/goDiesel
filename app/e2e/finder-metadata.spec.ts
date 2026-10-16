import { expect, test } from "@playwright/test";

for (const width of [390, 1280]) {
  test(`metadata search, explicit filters and saved route at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/#/finder");
    const query = page.getByLabel("Describe your next route");
    const search = page.getByRole("button", { name: "Find routes", exact: true });
    await query.fill("zip");
    await search.click();
    const sf = page.getByRole("article", { name: "Bay Area, CA candidate" });
    await expect(sf.getByRole("heading")).toHaveText("just here for the zipper");
    await expect(page.getByLabel("Active Finder filters")).toContainText("Any distance");
    await expect(page.getByRole("button", { name: "Clear location filter" })).toHaveCount(0);
    await page.reload();
    await expect(sf).toBeVisible();
    await page.getByRole("button", { name: "Edit filters" }).click();
    await page.getByRole("spinbutton", { name: "Distance km", exact: true }).fill("20");
    await query.fill("zipper");
    await search.click();
    await expect(page.getByText("No matching routes", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Active Finder filters")).toContainText("20 km");
    await page.getByRole("button", { name: "Search all places and distances" }).click();
    await expect(sf).toBeVisible();
    await expect(query).toHaveValue("zipper");
    await sf.getByRole("button", { name: "Save planned route" }).click();
    await sf.getByRole("link", { name: "View plans" }).click();
    await expect(page.getByRole("article", { name: "Planned route Bay Area, CA" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("article", { name: "Planned route Bay Area, CA" })).toBeVisible();
    await page.goto("/#/finder");
    await query.fill("could not figure out how to cross");
    await search.click();
    const tokyo = page.getByRole("article", { name: "Tokyo, Japan candidate" });
    await expect(tokyo.getByRole("heading")).toHaveText("crosswalk sprints");
    await expect(tokyo).toContainText("Description: could not figure out how to cross the bridge");
    await query.fill("🍑🍑");
    await search.click();
    await expect(page.getByRole("article")).toHaveCount(1);
    await expect(page.getByRole("article")).toHaveAccessibleName("Kyoto, Japan candidate");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
  test(`legacy zip link can widen filters without losing the query at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/#/finder?place=zip&activity=Run&distance=20&q=zip");
    await expect(page.getByText("No matching routes", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Search all places and distances" }).click();
    await expect(page.getByRole("article", { name: "Bay Area, CA candidate" })).toBeVisible();
    await expect(page.getByLabel("Describe your next route")).toHaveValue("zip");
    await page.reload();
    await expect(page.getByRole("article", { name: "Bay Area, CA candidate" })).toBeVisible();
  });
}

test("partial Strava title search works when the metadata index is unavailable", async ({ page }) => {
  await page.route("**/search/collection.json", route => route.fulfill({ status: 503, body: "Unavailable" }));
  await page.goto("/#/finder");
  await page.getByLabel("Describe your next route").fill("zip");
  await page.getByRole("button", { name: "Find routes", exact: true }).click();
  await expect(page.getByRole("article", { name: "Bay Area, CA candidate" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Finder results" }).getByRole("status")).toContainText("Search is limited");
});

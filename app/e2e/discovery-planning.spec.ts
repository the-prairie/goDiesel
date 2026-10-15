import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
const result = {
  id: "osm-123",
  name: "Creek paths",
  sourceUrl: "https://www.openstreetmap.org/relation/123",
  activity: "Run",
  distanceKm: 4,
  distanceKind: "mapped",
  lines: [
    [
      [0, 50],
      [0.01, 50],
    ],
    [
      [0.02, 50],
      [0.03, 50],
    ],
  ],
  surfaces: ["gravel"],
  surfaceCoverage: 0.5,
};
for (const width of [390, 1280])
  test(`discovery plan persists, exports sections and respects library filters at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/api/discovery?**", (r) =>
      r.fulfill({ json: { routes: [result] } }),
    );
    await page.goto("/#/finder?place=Kyoto&activity=Run&distance=0&scope=new");
    await page
      .getByRole("button", { name: "Search new routes", exact: true })
      .click();
    const candidate = page.getByRole("article", { name: "Creek paths" });
    await expect(candidate).toContainText("Disconnected sections");
    await expect(candidate).toContainText("Climb unknown");
    await candidate
      .getByRole("button", { name: "Save as planned", exact: true })
      .click();
    await expect(
      candidate.getByRole("button", { name: "Saved to plans" }),
    ).toBeDisabled();
    await candidate.getByRole("link", { name: "View planned routes" }).click();
    await page.reload();
    const plan = page.getByRole("article", {
      name: "Planned discovery Creek paths",
    });
    await expect(plan).toBeVisible();
    await expect(page.getByText("1 route", { exact: true })).toBeVisible();
    await plan.getByRole("button", { name: "Preview plan" }).click();
    await expect(
      page.getByRole("region", { name: "Finder route map" }),
    ).toHaveAttribute("data-map-status", "ready");
    await plan.getByText("Path and surface details", { exact: true }).click();
    await expect(plan).toContainText("Surface partly mapped (50%)");
    const downloadEvent = page.waitForEvent("download");
    await plan.getByRole("button", { name: "Download mapped GPX" }).click();
    const file = await downloadEvent;
    const xml = await readFile((await file.path())!, "utf8");
    expect(xml.match(/<trkseg>/g)).toHaveLength(2);
    expect(xml).not.toContain("<ele>");
    expect(xml).not.toContain("<time>");
    expect(await plan.getByRole("link", { name: /replay/i }).count()).toBe(0);
    await page.goto("/#/routes?lifecycle=planned&climb=under-250");
    await expect(
      page.getByRole("article", { name: "Planned discovery Creek paths" }),
    ).toHaveCount(0);
    await page.goto("/#/routes?lifecycle=completed");
    await expect(
      page.getByRole("article", { name: "Planned discovery Creek paths" }),
    ).toHaveCount(0);
    await page.goto("/#/routes?lifecycle=planned");
    await plan.getByRole("button", { name: "Preview plan" }).click();
    await plan.getByRole("button", { name: "Remove plan" }).click();
    await page.reload();
    await expect(plan).toHaveCount(0);
  });
test("failed storage never reports a saved plan", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw Error("QuotaExceeded");
    };
  });
  await page.route("**/api/discovery?**", (r) =>
    r.fulfill({ json: { routes: [result] } }),
  );
  await page.goto("/#/finder?place=Kyoto&activity=Run&distance=0&scope=new");
  await page
    .getByRole("button", { name: "Search new routes", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save as planned", exact: true })
    .click();
  await expect(
    page.getByRole("article", { name: "Creek paths" }).getByRole("status"),
  ).toContainText("Could not save");
  await expect(
    page.getByRole("button", { name: "Save as planned", exact: true }),
  ).toBeEnabled();
});

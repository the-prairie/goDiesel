import { expect, test } from "@playwright/test";
import { chooseSelectOption } from "./helpers/select-field";
import { readFileSync } from "node:fs";
const manifest = JSON.parse(readFileSync("src/data/generated/routes.manifest.json", "utf8")) as { routes: { region: string; lifecycle: string }[] };

const routes = manifest.routes.filter(r => r.lifecycle !== "planned");
const places = [...new Set(routes.map(r => r.region))].sort((a, b) => a.localeCompare(b));

for (const width of [390, 1280]) {
  test(`all collection places open their complete route groups at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/#/finder");
    const start = page.getByRole("region", { name: "Choose a starting place" });
    await expect(start.getByRole("button")).toHaveCount(places.length);
    for (const place of places) {
      const count = routes.filter(r => r.region === place).length;
      await expect(start.getByRole("button", { name: `${place}, ${count} ${count === 1 ? "route" : "routes"}`, exact: true })).toHaveCount(1);
    }
    await page.getByRole("button", { name: "Edit filters", exact: true }).click();
    await chooseSelectOption(page.getByRole("combobox", { name: "Activity", exact: true }), "Ride");
    await page.getByRole("spinbutton", { name: "Distance km", exact: true }).fill("100");
    await chooseSelectOption(page.getByRole("combobox", { name: "Terrain", exact: true }), "Road");
    await start.getByRole("button", { name: "Victoria, BC, 4 routes", exact: true }).click();
    const results = page.getByRole("region", { name: "Finder results" });
    await expect(results.getByRole("article")).toHaveCount(4);
    await expect(page.getByLabel("Active Finder filters")).toContainText("All activities");
    await expect(page.getByLabel("Active Finder filters")).toContainText("Any distance");
    await expect(results.getByRole("heading", { name: "Tour de farm", exact: true })).toBeVisible();
    const ride = results.getByRole("article").filter({ has: page.getByRole("heading", { name: "Tour de farm", exact: true }) });
    await ride.getByRole("button", { name: "Save planned route", exact: true }).click();
    await expect(ride.getByRole("status")).toContainText("Saved to Planned routes");
    await page.reload();
    await expect(results.getByRole("article")).toHaveCount(4);
    await expect(ride.getByRole("button", { name: "Already planned", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Edit filters", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Activity", exact: true })).toHaveText("All activities");
    await chooseSelectOption(page.getByRole("combobox", { name: "Activity", exact: true }), "Ride");
    await page.getByRole("button", { name: "Find routes", exact: true }).click();
    await expect(results.getByRole("article")).toHaveCount(1);
    await page.goBack();
    await expect(results.getByRole("article")).toHaveCount(4);
    await page.getByRole("button", { name: "Discover new routes", exact: true }).click();
    await expect(page.getByLabel("Active Finder filters")).toContainText("Run");
    await expect(page.getByLabel("Active Finder filters")).not.toContainText("All activities");
    await page.goto("/#/finder");
    await start.getByRole("button", { name: "Japan, 2 routes", exact: true }).click();
    await expect(results.getByRole("article")).toHaveCount(2);
    await expect(results.getByRole("article", { name: "Japan candidate", exact: true })).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

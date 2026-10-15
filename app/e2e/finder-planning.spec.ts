import { expect, test, type Page } from "@playwright/test";

const plannedRouteStorageKey = "godiesel.planned-routes.v1";

async function searchKyoto(page: Page) {
  const form = page.getByRole("form", { name: "Find a route" });
  await form.getByLabel("Describe your next route").fill("Kyoto");
  if (await form.getByRole("button", { name: "Edit filters", exact: true }).isVisible()) await form.getByRole("button", { name: "Edit filters", exact: true }).click();
  await form.getByLabel("Activity").selectOption("Run");
  await form.getByLabel("Distance").fill("21");
  await form.getByLabel("Terrain").selectOption("mixed");
  await form.getByLabel("Vibe").fill("exploratory climbing");
  await form.getByRole("button", { name: "Find routes" }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate((key) => localStorage.removeItem(key), plannedRouteStorageKey);
});

test("Finder searches explicit route-backed candidates and saves a durable plan", async ({
  page,
}) => {
  await page.goto("/#/finder");

  await expect(page.getByRole("heading", { name: "Plan the next day." })).toBeVisible();
  await expect(page.getByRole("region", { name: "Choose a starting place" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Finder route map" })).toHaveCount(0);
  await searchKyoto(page);

  await expect(page).toHaveURL(/#\/finder\?.*place=Kyoto/);
  await expect(page).toHaveURL(/activity=Run/);
  await expect(page).toHaveURL(/terrain=mixed/);
  const map = page.getByRole("region", { name: "Finder route map" });
  await expect(map).toBeVisible();
  await expect(map).toHaveAttribute("data-map-status", "ready", {
    timeout: 15_000,
  });
  await expect(map).toHaveAttribute("data-selected-route", "17654151284");

  const candidate = page.getByRole("article", { name: "Kyoto, Japan candidate" });
  await expect(candidate.getByRole("heading")).not.toHaveText("Kyoto, Japan");
  await expect(candidate).toContainText("21.3 km");
  await expect(page.getByLabel("Active Finder filters")).toContainText("mixed");
  await page.getByLabel("Describe your next route").fill("Patagonia");
  await candidate.getByRole("button", { name: "Save planned route" }).click();
  await expect(candidate.getByRole("status")).toContainText("Saved to Planned routes");

  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), plannedRouteStorageKey);
  expect(stored).toMatchObject({
    version: 1,
    routes: [
      {
        lifecycle: "planned",
        planning: {
          sourceRouteSlug: "17654151284",
          storeVersion: 1,
          intent: { place: "Kyoto" },
        },
      },
    ],
  });

  await page.reload();
  await searchKyoto(page);
  await expect(candidate.getByRole("button", { name: "Already planned" })).toBeDisabled();

  await page.goto("/#/routes?lifecycle=planned");
  const plannedCard = page.getByRole("article", { name: "Planned route Kyoto, Japan" });
  await expect(plannedCard).toBeVisible();
  await expect(plannedCard).toContainText("Planned");
  await expect(plannedCard).toContainText("Owner-curated from recorded GPX");
  await expect(plannedCard.getByRole("link", { name: "Open route guide" })).toHaveCount(0);
});

test("Finder explains source limits instead of fabricating an unsupported result", async ({
  page,
}) => {
  await page.goto("/#/finder");
  const form = page.getByRole("form", { name: "Find a route" });
  await form.getByLabel("Describe your next route").fill("Patagonia");
  if (await form.getByRole("button", { name: "Edit filters", exact: true }).isVisible()) await form.getByRole("button", { name: "Edit filters", exact: true }).click();
  await form.getByLabel("Activity").selectOption("Run");
  await form.getByLabel("Distance").fill("42");
  await form.getByLabel("Terrain").selectOption("trail");
  await form.getByLabel("Vibe").fill("remote");
  await form.getByRole("button", { name: "Find routes" }).click();

  const status = page.getByRole("region", { name: "Finder results" }).getByRole("status");
  await expect(status).toContainText("No collection routes match these filters");
  await expect(page.getByRole("article")).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), plannedRouteStorageKey)).toBeNull();
});

test("a planned route never changes completed Atlas totals", async ({ page }) => {
  await page.goto("/#/atlas");
  const initialNavigation = page.getByTestId("atlas-spine");
  const initialTotals = (await initialNavigation.locator("p").allTextContents()).filter((text) =>
    /^(\d+ routes|\d+ km inked)$/.test(text),
  );
  expect(initialTotals).toHaveLength(2);

  await page.goto("/#/finder");
  await searchKyoto(page);
  await page.getByRole("button", { name: "Save planned route" }).click();

  await page.goto("/#/atlas");
  const navigation = page.getByTestId("atlas-spine");
  const finalTotals = (await navigation.locator("p").allTextContents()).filter((text) =>
    /^(\d+ routes|\d+ km inked)$/.test(text),
  );
  expect(finalTotals).toEqual(initialTotals);
  await expect(page.getByText("planned-owner-route-17654151284")).toHaveCount(0);
});

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`Finder planning workspace fits ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/#/finder");
    await searchKyoto(page);
    await expect(page.getByRole("article", { name: "Kyoto, Japan candidate" })).toBeVisible();

    const layout = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }));
    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
  });
}

test("Finder restores submitted intent through history and exposes removable mobile chips", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/finder");
  await searchKyoto(page);

  await expect(page.getByRole("button", { name: "Remove terrain filter" })).toBeVisible();
  await page.goto("/#/routes");
  await page.goBack();
  await page.getByRole("button", { name: "Edit filters" }).click();
  const form = page.getByRole("form", { name: "Find a route" });
  await expect(form.getByLabel("Describe your next route")).toHaveValue("Kyoto");
  await expect(form.getByLabel("Terrain")).toHaveValue("mixed");
  await expect(page.getByRole("article", { name: "Kyoto, Japan candidate" })).toBeVisible();

  await page.getByRole("button", { name: "Remove terrain filter" }).click();
  await expect(form.getByLabel("Terrain")).toHaveValue("any");
  await expect(page).not.toHaveURL(/terrain=mixed/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    390,
  );
});

test("Finder exposes applied preferences and edits distance without pretending to remove it", async ({ page }) => {
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/#/finder");
    await expect(page.getByLabel("Search preferences")).toHaveText("Search for: Run · around 20 km");
    await page.getByRole("button", { name: "Kyoto", exact: true }).click();
    const filters = page.getByLabel("Active Finder filters");
    await expect(filters).toBeVisible();
    await expect(filters).toContainText("Run");
    await expect(page.getByRole("button", { name: "Remove distance filter" })).toHaveCount(0);
    await page.getByRole("button", { name: "Edit distance target" }).click();
    const distance = page.getByRole("spinbutton", { name: "Distance km", exact: true });
    await expect(distance).toBeFocused();
    await distance.fill("25");
    await expect(page.getByLabel("Search preferences")).toContainText("Not applied yet: Run · around 25 km");
    await expect(filters).toContainText("Around 21 km");
    await page.getByRole("button", { name: "Find routes" }).click();
    await expect(page).toHaveURL(/distance=25/);
    await expect(filters).toContainText("Around 25 km");
  }
});

import { expect, test, type Page } from "@playwright/test";

const plannedRouteStorageKey = "godiesel.planned-routes.v1";

async function searchKyoto(page: Page) {
  const form = page.getByRole("form", { name: "Find a route" });
  await form.getByLabel("Place").fill("Kyoto");
  await form.getByLabel("Activity").selectOption("Run");
  await form.getByLabel("Distance").fill("21");
  await form.getByLabel("Terrain").selectOption("mixed");
  await form.getByLabel("Vibe").fill("exploratory climbing");
  await form.getByRole("button", { name: "Find curated routes" }).click();
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
  await expect(page.getByText("Finder does not generate routes.")).toBeVisible();
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
  await expect(map).toHaveAttribute("data-route-count", "1");

  const candidate = page.getByRole("article", { name: "Kyoto, Japan candidate" });
  await expect(candidate).toContainText("Owner-curated from recorded GPX");
  await expect(candidate).toContainText("21.3 km");
  await expect(candidate).toContainText("Why it matches");
  await expect(candidate).toContainText(/mixed terrain/i);
  await page.getByLabel("Place").fill("Patagonia");
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

test("Finder previews a candidate spatially before committing it to the URL", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/#/finder");
  await searchKyoto(page);

  const map = page.getByRole("region", { name: "Finder route map" });
  const candidate = page.getByRole("article", { name: "Kyoto, Japan candidate" });
  await expect(page).not.toHaveURL(/candidate=/);

  await candidate.hover();
  await expect(map).toHaveAttribute("data-previewed-route", "17654151284");
  await expect(page).not.toHaveURL(/candidate=/);

  await candidate.getByRole("button", { name: "Choose Kyoto, Japan" }).click();
  await expect(page).toHaveURL(/candidate=17654151284/);
  await expect(map).toHaveAttribute("data-selected-route", "17654151284");
});

test("Finder explains source limits instead of fabricating an unsupported result", async ({
  page,
}) => {
  await page.goto("/#/finder");
  const form = page.getByRole("form", { name: "Find a route" });
  await form.getByLabel("Place").fill("Patagonia");
  await form.getByLabel("Activity").selectOption("Run");
  await form.getByLabel("Distance").fill("42");
  await form.getByLabel("Terrain").selectOption("trail");
  await form.getByLabel("Vibe").fill("remote");
  await form.getByRole("button", { name: "Find curated routes" }).click();

  const status = page.getByRole("region", { name: "Finder results" }).getByRole("status");
  await expect(status).toContainText("No owner-curated route matches this search yet");
  await expect(page.getByRole("article")).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), plannedRouteStorageKey)).toBeNull();
});

test("a planned route never changes completed Atlas totals", async ({ page }) => {
  await page.goto("/#/atlas");
  await page.getByRole("button", { name: "Open application navigation" }).click();
  const initialNavigation = page.getByRole("dialog", { name: "goDiesel navigation" });
  const initialTotals = (await initialNavigation.locator("p").allTextContents()).filter((text) =>
    /^(\d+ routes|\d+ km inked)$/.test(text),
  );
  expect(initialTotals).toHaveLength(2);

  await page.goto("/#/finder");
  await searchKyoto(page);
  await page.getByRole("button", { name: "Save planned route" }).click();

  await page.goto("/#/atlas");
  await page.getByRole("button", { name: "Open application navigation" }).click();
  const navigation = page.getByRole("dialog", { name: "goDiesel navigation" });
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
  await expect(page.getByRole("dialog", { name: "Edit route plan" })).toBeVisible();
  const form = page.getByRole("form", { name: "Find a route" });
  await expect(form.getByLabel("Place")).toHaveValue("Kyoto");
  await expect(form.getByLabel("Terrain")).toHaveValue("mixed");
  await expect(page.getByRole("article", { name: "Kyoto, Japan candidate" })).toBeVisible();

  await page.getByRole("button", { name: "Remove terrain filter" }).click();
  await expect(form.getByLabel("Terrain")).toHaveValue("any");
  await expect(page).not.toHaveURL(/terrain=mixed/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    390,
  );
});

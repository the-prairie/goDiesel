import { expect, test, type Page } from "@playwright/test";

const plannedRouteStorageKey = "godiesel.planned-routes.v1";

async function searchKyoto(page: Page) {
  const existingForm = page.getByRole("form", { name: "Find a route" });
  if (!(await existingForm.isVisible())) {
    await page.getByRole("button", { name: /^(Shape the day|Edit filters)$/ }).click();
  }
  const form = page.getByRole("form", { name: "Find a route" });
  await form.getByLabel("Place").fill("Kyoto");
  await form.getByLabel("Activity").selectOption("Run");
  await form.getByLabel("Distance").fill("21");
  await form.getByLabel("Terrain").selectOption("mixed");
  await form.getByLabel("Vibe").fill("exploratory climbing");
  await form.getByRole("button", { name: "Find curated routes" }).click();
}

async function searchBanff(page: Page) {
  const existingForm = page.getByRole("form", { name: "Find a route" });
  if (!(await existingForm.isVisible())) {
    await page.getByRole("button", { name: /^(Shape the day|Edit filters)$/ }).click();
  }
  const form = page.getByRole("form", { name: "Find a route" });
  await form.getByLabel("Place").fill("Banff");
  await form.getByLabel("Activity").selectOption("Run");
  await form.getByLabel("Distance").fill("21");
  await form.getByLabel("Terrain").selectOption("trail");
  await form.getByLabel("Vibe").fill("big day");
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
  await expect(map).toHaveAttribute("data-map-style", "fiord");
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

  await page.goto("/#/routes");
  await expect(page.getByRole("article", { name: "Planned route Kyoto" })).toHaveCount(0);

  await page.goto("/#/routes?lifecycle=planned");
  const plannedCard = page.getByRole("article", { name: "Planned route Kyoto" });
  await expect(plannedCard).toBeVisible();
  await expect(plannedCard).toContainText("Planning intent");
  await expect(page.getByRole("heading", { name: "Routes waiting to be made." })).toBeVisible();
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
  await page.getByRole("button", { name: "Shape the day" }).click();
  const form = page.getByRole("form", { name: "Find a route" });
  await form.getByLabel("Place").fill("Patagonia");
  await form.getByLabel("Activity").selectOption("Run");
  await form.getByLabel("Distance").fill("42");
  await form.getByLabel("Terrain").selectOption("trail");
  await form.getByLabel("Vibe").fill("remote");
  await form.getByRole("button", { name: "Find curated routes" }).click();

  const status = page.getByRole("region", { name: "Finder results" }).getByRole("status");
  await expect(status).toContainText("No owner-curated route matches this search yet");
  await expect(page.getByText("Choose the shape of the day.")).toHaveCount(0);
  await expect(page.getByRole("article")).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), plannedRouteStorageKey)).toBeNull();

  const editSearch = page.getByRole("button", { name: "Edit search" });
  await editSearch.click();
  const dialog = page.getByRole("dialog", { name: "Shape the next day" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(editSearch).toBeFocused();

  await editSearch.click();
  await dialog.getByLabel("Place").fill("Kyoto");
  await dialog.getByLabel("Distance").fill("21");
  await dialog.getByLabel("Terrain").selectOption("mixed");
  await dialog.getByLabel("Vibe").fill("exploratory climbing");
  await dialog.getByRole("button", { name: "Find curated routes" }).click();
  await expect(page.getByRole("article", { name: "Kyoto, Japan candidate" })).toBeVisible();
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

test("a planned route has a durable detail, edit, and remove journey", async ({ page }) => {
  await page.goto("/#/finder");
  await searchKyoto(page);
  await page.getByRole("button", { name: "Save planned route" }).click();

  await page.goto("/#/routes?lifecycle=planned");
  await page.getByRole("link", { name: "Open planned Kyoto route" }).click();

  await expect(page).toHaveURL(/#\/routes\/planned-owner-route-17654151284$/);
  await expect(page.getByRole("heading", { name: "Kyoto" })).toBeVisible();
  await expect(page.getByText("This is a plan, not a recorded activity.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Living planning preview" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What this plan does" })).toBeVisible();
  await expect(page.getByText("No later recorded activity matches this plan yet.")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => window.innerWidth + 1),
  );

  await page.getByRole("button", { name: "Edit plan" }).click();
  const editPlan = page.getByRole("dialog", { name: "Edit planned route" });
  await expect(editPlan).toContainText("Changes update what Finder watches for");
  await editPlan.getByLabel("Planning source").selectOption("5650407638");
  await expect(editPlan.getByLabel("Place")).toHaveValue("Victoria, BC");
  await expect(editPlan.getByLabel("Activity")).toHaveValue("Ride");
  await editPlan.getByLabel("Distance").fill("90");
  await editPlan.getByLabel("Vibe").fill("quiet farm roads");
  await editPlan.getByRole("button", { name: "Save plan changes" }).click();
  await expect(page).toHaveURL(/#\/routes\/planned-owner-route-5650407638$/);
  await expect(page.getByText("90.0 km", { exact: true })).toBeVisible();
  await expect(page.getByText("quiet farm roads", { exact: true })).toBeVisible();

  const storedPlanning = await page.evaluate((key) => {
    const value = JSON.parse(localStorage.getItem(key) ?? "null");
    return value.routes[0].planning;
  }, plannedRouteStorageKey);
  expect(storedPlanning).toMatchObject({
    sourceRouteSlug: "5650407638",
    intent: {
      place: "Victoria, BC",
      activity: "Ride",
      distanceKm: 90,
      vibe: "quiet farm roads",
    },
  });

  await page.goto("/#/routes?lifecycle=planned");
  const updatedCard = page.getByRole("article", { name: "Planned route Victoria, BC" });
  await expect(updatedCard).toContainText("90.0 km");
  await expect(updatedCard).toContainText("Ride");
  await expect(updatedCard).toContainText("Road");
  await expect(updatedCard).not.toContainText("21.3 km");
  await updatedCard.getByRole("link", { name: "Open planned Victoria, BC route" }).click();

  await page.getByRole("link", { name: "Reopen source in Finder" }).click();
  await expect(page).toHaveURL(/#\/finder\?.*candidate=5650407638/);
  await expect(page.getByRole("article", { name: "Victoria, BC candidate" })).toBeVisible();
  await page.goBack();

  await page.getByRole("button", { name: "Remove plan" }).click();
  await page.getByRole("button", { name: "Keep plan" }).click();
  await expect(page.getByRole("button", { name: "Remove plan" })).toBeFocused();
  await page.getByRole("button", { name: "Remove plan" }).click();
  await page.getByRole("button", { name: "Remove planned route" }).click();
  await expect(page).toHaveURL(/#\/routes\?lifecycle=planned$/);
  await expect(page.getByRole("article", { name: "Planned route Victoria, BC" })).toHaveCount(0);
});

test("Finder filter chips never collide with the edit control", async ({ page }) => {
  await page.setViewportSize({ width: 1340, height: 900 });
  await page.goto("/#/finder");
  await searchKyoto(page);

  const chipTray = page.getByLabel("Active Finder filters");
  const editFilters = page.getByRole("button", { name: "Edit filters" });
  const [trayBox, editBox] = await Promise.all([
    chipTray.boundingBox(),
    editFilters.boundingBox(),
  ]);

  expect(trayBox).not.toBeNull();
  expect(editBox).not.toBeNull();
  expect((trayBox?.x ?? 0) + (trayBox?.width ?? 0)).toBeLessThanOrEqual(
    (editBox?.x ?? 0) - 4,
  );
});

test("a failed durable write keeps the plan open and reports the problem", async ({ page }) => {
  await page.goto("/#/finder");
  await searchKyoto(page);
  await page.getByRole("button", { name: "Save planned route" }).click();
  await page.goto("/#/routes/planned-owner-route-17654151284");

  await page.evaluate(() => {
    Object.defineProperty(window, "__originalSetItem", {
      configurable: true,
      value: Storage.prototype.setItem,
    });
    Storage.prototype.setItem = () => {
      throw new DOMException("Storage blocked", "SecurityError");
    };
  });
  await page.getByRole("button", { name: "Edit plan" }).click();
  const editPlan = page.getByRole("dialog", { name: "Edit planned route" });
  await editPlan.getByLabel("Distance").fill("24");
  await editPlan.getByRole("button", { name: "Save plan changes" }).click();
  await expect(editPlan.getByRole("alert")).toContainText("Plan changes could not be saved");
  await editPlan.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Remove plan" }).click();
  await page.getByRole("button", { name: "Remove planned route" }).click();

  await expect(page).toHaveURL(/#\/routes\/planned-owner-route-17654151284$/);
  await expect(page.getByRole("alert")).toContainText("Plan could not be removed");
  await expect(page.getByRole("heading", { name: "Kyoto" })).toBeVisible();
});

test("Finder reopens a saved source snapshot after its catalog entry is retired", async ({ page }) => {
  await page.goto("/#/finder");
  await searchKyoto(page);
  await page.getByRole("button", { name: "Save planned route" }).click();
  await page.evaluate((key) => {
    const value = JSON.parse(localStorage.getItem(key) ?? "null");
    value.routes[0].planning.candidateId = "owner-route-retired-kyoto";
    value.routes[0].planning.sourceRouteSlug = "retired-kyoto-source";
    value.routes[0].planning.sourceSnapshot.slug = "retired-kyoto-source";
    localStorage.setItem(key, JSON.stringify(value));
  }, plannedRouteStorageKey);

  await page.goto("/#/routes/planned-owner-route-17654151284");
  await page.getByRole("link", { name: "Reopen source in Finder" }).click();

  await expect(page).toHaveURL(/candidate=retired-kyoto-source/);
  await expect(page.getByText("Saved planning source reopened from its durable route snapshot."))
    .toBeVisible();
  await expect(page.getByRole("region", { name: "Finder route map" }))
    .toHaveAttribute("data-selected-route", "retired-kyoto-source");
});

test("Finder reports a plan that browser storage could not save", async ({ page }) => {
  await page.goto("/#/finder");
  await searchKyoto(page);
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("Storage blocked", "SecurityError");
    };
  });

  const candidate = page.getByRole("article", { name: "Kyoto, Japan candidate" });
  await candidate.getByRole("button", { name: "Save planned route" }).click();

  await expect(candidate.getByRole("alert")).toContainText("Plan could not be saved");
  await expect(candidate.getByRole("button", { name: "Save planned route" })).toBeEnabled();
});

test("a plan becomes a memory only after confirming a later recorded match", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/finder");
  await searchBanff(page);
  await page.getByRole("button", { name: "Save planned route" }).click();

  await page.evaluate((key) => {
    const value = JSON.parse(localStorage.getItem(key) ?? "null");
    value.routes[0].planning.createdAt = "2024-10-01T12:00:00.000Z";
    value.routes[0].date = "2024-10-01";
    localStorage.setItem(key, JSON.stringify(value));
  }, plannedRouteStorageKey);

  await page.goto("/#/routes/planned-owner-route-13358070690");
  const candidate = page.getByRole("article", { name: /Recorded completion candidate/ }).first();
  await expect(candidate).toContainText("Derived match");
  await expect(candidate).toContainText("Recorded activity");

  const storedBeforeConfirmation = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? "null").routes.length,
    plannedRouteStorageKey,
  );
  expect(storedBeforeConfirmation).toBe(1);

  await candidate.getByRole("button", { name: "Compare recorded activity" }).click();
  const comparison = page.getByRole("dialog", {
    name: "Compare plan with recorded activity",
  });
  await expect(comparison.getByText("Planning target")).toBeVisible();
  await expect(comparison.getByText("Recorded activity", { exact: true })).toBeVisible();
  await expect(comparison.getByText("Derived geometry comparison")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  await page.evaluate(() => {
    Object.defineProperty(window, "__originalSetItem", {
      configurable: true,
      value: Storage.prototype.setItem,
    });
    Storage.prototype.setItem = () => {
      throw new DOMException("Storage blocked", "SecurityError");
    };
  });
  await comparison.getByRole("button", { name: "Confirm recorded completion" }).click();
  await expect(comparison.getByRole("alert")).toContainText("Completion could not be confirmed");
  await page.evaluate(() => {
    Storage.prototype.setItem = (
      window as typeof window & { __originalSetItem: typeof Storage.prototype.setItem }
    ).__originalSetItem;
  });
  await comparison.getByRole("button", { name: "Confirm recorded completion" }).click();

  await expect(page).toHaveURL(/#\/routes\/(?!planned-)[^?]+$/);
  await expect(page.getByText("This is a plan, not a recorded activity.")).toHaveCount(0);
  const storedAfterConfirmation = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? "null").routes.length,
    plannedRouteStorageKey,
  );
  expect(storedAfterConfirmation).toBe(0);
});

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "compact desktop", width: 768, height: 576 },
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

    if (viewport.name === "compact desktop") {
      const headerBox = await page.getByTestId("finder-header").boundingBox();
      const resultsBox = await page.getByTestId("finder-results").boundingBox();
      expect((headerBox?.y ?? 0) + (headerBox?.height ?? 0)).toBeLessThanOrEqual(
        resultsBox?.y ?? 0,
      );
    }
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
  await expect(page.getByRole("dialog", { name: "Shape the next day" })).toBeVisible();
  const form = page.getByRole("form", { name: "Find a route" });
  await expect(form.getByLabel("Place")).toHaveValue("Kyoto");
  await expect(form.getByLabel("Terrain")).toHaveValue("mixed");
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("article", { name: "Kyoto, Japan candidate" })).toBeVisible();

  await page.getByRole("button", { name: "Remove terrain filter" }).click();
  await expect(page).not.toHaveURL(/terrain=mixed/);
  await page.getByRole("button", { name: "Edit filters" }).click();
  await expect(page.getByRole("form", { name: "Find a route" }).getByLabel("Terrain")).toHaveValue("any");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    390,
  );
});

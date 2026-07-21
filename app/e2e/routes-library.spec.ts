import { expect, test, type Locator, type Page } from "@playwright/test";

const reviewedKyotoSlug = "17654151284";
const draftTokyoSlug = "17665674778";

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function boxesOverlap(first: Box, second: Box) {
  return (
    first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y
  );
}

function routeSearchParam(page: Page, name: string) {
  const query = new URL(page.url()).hash.split("?")[1] ?? "";
  return new URLSearchParams(query).get(name);
}

function detailRequestUrls(page: Page) {
  const urls: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/data/routes/")) urls.push(request.url());
  });
  return urls;
}

function routeCards(page: Page) {
  return page.getByRole("region", { name: "Route results" }).getByRole("article");
}

function routeCardWithText(page: Page, text: string | RegExp) {
  return routeCards(page).filter({ hasText: text });
}

async function boxesFor(locator: Locator) {
  return locator.evaluateAll((elements) =>
    elements.map((element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    }),
  );
}

test("Atlas remains the default home while Routes stays secondary", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/#\/atlas$/);
  await expect(page.getByRole("link", { name: "Memories", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.getByRole("button", { name: "Open application navigation" }).click();
  const navigation = page.getByRole("dialog", { name: "goDiesel navigation" });
  await expect(navigation.getByRole("link", { name: "Atlas", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(navigation.getByRole("link", { name: "Routes", exact: true })).not.toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("Routes progressively reveals all summaries without fetching route detail JSON", async ({
  page,
}) => {
  const detailRequests = detailRequestUrls(page);

  await page.goto("/#/routes");

  await expect(page.getByRole("link", { name: "Routes", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(routeCards(page)).toHaveCount(24);
  await expect(page.getByText(/showing 24 of 66 routes/i)).toBeVisible();
  await page.getByRole("button", { name: "Load more routes" }).click();
  await expect(routeCards(page)).toHaveCount(48);
  await expect.poll(() => routeSearchParam(page, "page")).toBe("2");
  await page.getByRole("button", { name: "Load more routes" }).click();
  await expect(routeCards(page)).toHaveCount(66);
  await expect(page.getByRole("button", { name: "Load more routes" })).toHaveCount(0);
  const cardNames = await routeCards(page)
    .getByRole("link")
    .evaluateAll((links) => links.map((link) => link.getAttribute("aria-label")));
  expect(new Set(cardNames).size).toBe(cardNames.length);
  expect(detailRequests).toEqual([]);
});

test("Routes presents an editorial comparison ledger on desktop and compact entries on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/routes?q=exploratory");

  const ledger = page.getByTestId("route-ledger");
  await expect(ledger).toBeVisible();
  await expect(page.getByTestId("route-ledger-head")).toContainText(
    "DateActivityDistanceClimbVibeLifecycleAction",
  );
  const desktopRow = routeCards(page).first();
  const desktopBox = await desktopRow.boundingBox();
  expect(desktopBox).not.toBeNull();
  expect(desktopBox!.width).toBeGreaterThan(900);
  expect(desktopBox!.height).toBeLessThan(190);
  await expect(desktopRow).toContainText("Run");
  await expect(desktopRow).toContainText("21.3 km");
  await expect(desktopRow).toContainText("680 m up");
  await expect(desktopRow).toContainText("Completed");
  await expect(desktopRow).toContainText(/long, exploratory Kyoto run/i);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  const mobileRow = routeCards(page).first();
  const mobileBox = await mobileRow.boundingBox();
  expect(mobileBox).not.toBeNull();
  expect(mobileBox!.width).toBeLessThanOrEqual(358);
  expect(mobileBox!.height).toBeLessThan(280);
  await expect(page.getByTestId("route-ledger-head")).toBeHidden();
});

test("search and every route filter update the URL", async ({ page }) => {
  await page.goto("/#/routes");
  const filters = page.getByRole("form", { name: "Route filters" });

  await filters.getByRole("searchbox", { name: "Search routes" }).fill("kyoto");
  await expect.poll(() => routeSearchParam(page, "q")).toBe("kyoto");

  await filters.getByRole("combobox", { name: "Lifecycle" }).selectOption("completed");
  await expect.poll(() => routeSearchParam(page, "lifecycle")).toBe("completed");

  await filters.getByRole("combobox", { name: "Activity" }).selectOption("Run");
  await expect.poll(() => routeSearchParam(page, "activity")).toBe("Run");

  await filters.getByRole("combobox", { name: "Region" }).selectOption("Kyoto, Japan");
  await expect.poll(() => routeSearchParam(page, "region")).toBe("Kyoto, Japan");

  await filters.getByRole("combobox", { name: "Distance" }).selectOption("20-50");
  await expect.poll(() => routeSearchParam(page, "distance")).toBe("20-50");

  await filters.getByRole("combobox", { name: "Climb" }).selectOption("250-750");
  await expect.poll(() => routeSearchParam(page, "climb")).toBe("250-750");

  await filters.getByRole("combobox", { name: "Vibe" }).selectOption("Big Day");
  await expect.poll(() => routeSearchParam(page, "vibe")).toBe("Big Day");
});

test("combined route filters persist through reload", async ({ page }) => {
  await page.goto(
    "/#/routes?q=exploratory&lifecycle=completed&activity=Run&region=Kyoto%2C+Japan&distance=20-50&climb=250-750&vibe=Big+Day",
  );
  const filters = page.getByRole("form", { name: "Route filters" });

  await expect(filters.getByRole("searchbox", { name: "Search routes" })).toHaveValue(
    "exploratory",
  );
  await expect(filters.getByRole("combobox", { name: "Lifecycle" })).toHaveValue(
    "completed",
  );
  await expect(filters.getByRole("combobox", { name: "Activity" })).toHaveValue("Run");
  await expect(filters.getByRole("combobox", { name: "Region" })).toHaveValue(
    "Kyoto, Japan",
  );
  await expect(filters.getByRole("combobox", { name: "Distance" })).toHaveValue("20-50");
  await expect(filters.getByRole("combobox", { name: "Climb" })).toHaveValue("250-750");
  await expect(filters.getByRole("combobox", { name: "Vibe" })).toHaveValue("Big Day");
  await expect(routeCards(page)).toHaveCount(1);
  await expect(routeCards(page).first()).toContainText("Kyoto, Japan");

  await page.reload();

  await expect(filters.getByRole("searchbox", { name: "Search routes" })).toHaveValue(
    "exploratory",
  );
  await expect(filters.getByRole("combobox", { name: "Region" })).toHaveValue(
    "Kyoto, Japan",
  );
  await expect(routeCards(page)).toHaveCount(1);
  await expect.poll(() => routeSearchParam(page, "climb")).toBe("250-750");
});

test("no matching routes are announced and all filters can be reset", async ({ page }) => {
  await page.goto("/#/routes?q=no-route-could-possibly-match&activity=Ride");

  const noResults = page.getByRole("status");
  await expect(noResults).toContainText("No routes found");
  await expect(routeCards(page)).toHaveCount(0);
  await noResults.getByRole("button", { name: "Reset filters" }).click();

  await expect(page).toHaveURL(/#\/routes$/);
  await expect(routeCards(page)).toHaveCount(24);
  await expect(page.getByRole("searchbox", { name: "Search routes" })).toHaveValue("");
});

test("filters remain correct while loading every matching route", async ({ page }) => {
  await page.goto("/#/routes?activity=Run");

  await expect(routeCards(page)).toHaveCount(24);
  const resultCount = Number(
    (await page.getByTestId("route-result-count").getAttribute("data-total")) ?? 0,
  );
  while ((await routeCards(page).count()) < resultCount) {
    const previousCount = await routeCards(page).count();
    await page.getByRole("button", { name: "Load more routes" }).click();
    await expect.poll(() => routeCards(page).count()).toBeGreaterThan(previousCount);
  }
  await expect(routeCards(page)).toHaveCount(resultCount);
  for (const card of await routeCards(page).all()) {
    await expect(card).toContainText("Run");
  }
});

test("returning from a guide restores filters, loaded depth, and scroll", async ({ page }) => {
  await page.goto("/#/routes?activity=Run&page=2");
  await expect(routeCards(page)).toHaveCount(48);
  const target = routeCards(page).nth(36).getByRole("link");
  await target.scrollIntoViewIfNeeded();
  const priorScrollY = await page.evaluate(() => window.scrollY);
  expect(priorScrollY).toBeGreaterThan(0);
  await target.click();

  await page.getByRole("link", { name: "All routes" }).click();
  await expect(page).toHaveURL(/#\/routes\?activity=Run&page=2$/);
  await expect(routeCards(page)).toHaveCount(48);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(
    priorScrollY - 100,
  );
});

test("blocked session storage never prevents opening a route guide", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("Storage blocked", "SecurityError");
    };
  });
  await page.goto("/#/routes?q=exploratory");

  await routeCards(page).first().getByRole("link").click();
  await expect(page).toHaveURL(/#\/routes\/17654151284$/);
  await expect(page.getByRole("heading", { name: "Kyoto, Japan" })).toBeVisible();
});

test("reviewed Kyoto card opens its canonical guide and fetches only that detail", async ({
  page,
}) => {
  const detailRequests = detailRequestUrls(page);
  await page.goto("/#/routes?q=exploratory");

  const kyotoCard = routeCardWithText(page, /long, exploratory Kyoto run/i);
  await expect(kyotoCard).toHaveCount(1);
  await expect(kyotoCard).toContainText("Reviewed");
  await expect(kyotoCard).toContainText(/long, exploratory Kyoto run/i);
  expect(detailRequests).toEqual([]);

  const canonicalGuide = kyotoCard.getByRole("link", {
    name: "Open Kyoto, Japan route from 2025-11-24, 21.3 km",
  });
  await expect(canonicalGuide).toHaveAttribute("href", `#/routes/${reviewedKyotoSlug}`);
  await canonicalGuide.click();

  await expect(page).toHaveURL(new RegExp(`#\/routes\/${reviewedKyotoSlug}$`));
  await expect(page.getByRole("heading", { name: "What it feels like" })).toBeVisible();
  await expect.poll(() => detailRequests.length).toBe(1);
  expect(detailRequests[0]).toMatch(
    new RegExp(`/data/routes/${reviewedKyotoSlug}\\.json$`),
  );
});

test("draft cards identify themselves without invented reviewed copy", async ({ page }) => {
  await page.goto("/#/routes?q=crosswalk+sprints");

  const draftCard = routeCardWithText(page, "crosswalk sprints");
  await expect(draftCard).toHaveCount(1);
  await expect(draftCard).toContainText("Draft guide");
  await expect(draftCard).not.toContainText("Reviewed");
  await expect(draftCard).not.toContainText("What it feels like");
  await expect(
    draftCard.getByRole("link", {
      name: "Open Tokyo, Japan route from 2025-11-26, 21.8 km",
    }),
  ).toHaveAttribute("href", `#/routes/${draftTokyoSlug}`);
});

test("invalid and unknown filter parameters are removed from the shared URL", async ({
  page,
}) => {
  await page.goto("/#/routes?activity=NotReal&distance=nearby&junk=x");

  await expect(page).toHaveURL(/#\/routes$/);
  await expect(routeCards(page)).toHaveCount(24);
  await expect(page.getByRole("combobox", { name: "Activity" })).toHaveValue("all");
  await expect(page.getByRole("button", { name: "Reset filters" })).toHaveCount(0);
});

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`planned and empty library states remain usable on ${viewport.name}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/#/finder");
    const finder = page.getByRole("form", { name: "Find a route" });
    await finder.getByLabel("Place").fill("Kyoto");
    await finder.getByLabel("Activity").selectOption("Run");
    await finder.getByLabel("Distance").fill("21");
    await finder.getByLabel("Terrain").selectOption("mixed");
    await finder.getByLabel("Vibe").fill("exploratory climbing");
    await finder.getByRole("button", { name: "Find curated routes" }).click();
    await page.getByRole("button", { name: "Save planned route" }).click();

    await page.goto("/#/routes?lifecycle=planned");
    await expect(
      page.getByRole("article", { name: "Planned route Kyoto, Japan" }),
    ).toBeVisible();
    await expect(page.getByText("1 route", { exact: true })).toBeVisible();

    await page.goto("/#/routes?q=no-route-could-possibly-match");
    await expect(page.getByRole("status")).toContainText("No routes found");
    await expect(page.getByRole("button", { name: "Load more routes" })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width + 1,
    );
  });
}

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`Routes has no horizontal overflow or overlapping content on ${viewport.name}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/#/routes");
    await expect(routeCards(page)).toHaveCount(24);

    const filters = page.getByRole("form", { name: "Route filters" });
    const results = page.getByRole("region", { name: "Route results" });
    const filterBox = await filters.boundingBox();
    const resultsBox = await results.boundingBox();
    expect(filterBox).not.toBeNull();
    expect(resultsBox).not.toBeNull();
    expect(boxesOverlap(filterBox!, resultsBox!)).toBe(false);

    const layout = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }));
    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);

    const cardBoxes = await boxesFor(routeCards(page));
    for (const card of cardBoxes) {
      expect(card.x).toBeGreaterThanOrEqual(-1);
      expect(card.x + card.width).toBeLessThanOrEqual(viewport.width + 1);
    }
    for (let first = 0; first < cardBoxes.length; first += 1) {
      for (let second = first + 1; second < cardBoxes.length; second += 1) {
        expect(boxesOverlap(cardBoxes[first], cardBoxes[second])).toBe(false);
      }
    }

    if (viewport.name === "mobile") {
      const filterButton = page.getByRole("button", { name: "Filters" });
      await expect(filterButton).toHaveAttribute("aria-expanded", "false");
      expect(cardBoxes[0].y).toBeLessThan(viewport.height);
      await filterButton.click();
      await expect(filterButton).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByRole("combobox", { name: "Lifecycle" })).toBeVisible();
    }
  });
}

test("invalid and malformed route links remain intentional unavailable states", async ({
  page,
}) => {
  const detailRequests = detailRequestUrls(page);

  for (const slug of ["not-a-real-route", "%", "%E0%A4%A"]) {
    await page.goto(`/#/routes/${slug}`);
    await expect(
      page.getByRole("heading", { name: "This route could not be found." }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Browse routes" })).toHaveAttribute(
      "href",
      "#/routes",
    );
  }
  for (const slug of ["%", "%E0%A4%A"]) {
    await page.goto(`/#/replay/${slug}`);
    await expect(
      page.getByRole("heading", { name: "This route could not be found." }),
    ).toBeVisible();
  }
  expect(detailRequests).toEqual([]);
});

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
  await expect(page.getByRole("link", { name: "Atlas", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  const navigation = page.getByTestId("atlas-spine");
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
  const initialSummary = page.getByText(/showing 24 of \d+ routes/i);
  await expect(initialSummary).toBeVisible();
  const routeTotal = Number((await initialSummary.textContent())?.match(/of (\d+)/)?.[1]);
  expect(routeTotal).toBeGreaterThan(48);
  await page.getByRole("button", { name: "Load more routes" }).click();
  await expect(routeCards(page)).toHaveCount(48);
  await expect.poll(() => routeSearchParam(page, "page")).toBe("2");
  await page.getByRole("button", { name: "Load more routes" }).click();
  await expect(routeCards(page)).toHaveCount(routeTotal);
  await expect(page.getByRole("button", { name: "Load more routes" })).toHaveCount(0);
  const cardNames = await routeCards(page)
    .getByRole("link")
    .evaluateAll((links) => links.map((link) => link.getAttribute("aria-label")));
  expect(new Set(cardNames).size).toBe(cardNames.length);
  expect(detailRequests).toEqual([]);
});

test("Routes presents aerial field notes on desktop and mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#/routes?q=exploratory");

  const ledger = page.getByTestId("route-ledger");
  await expect(ledger).toBeVisible();
  await expect(ledger.getByRole("img", { name: /recorded route trace/ }).first()).toBeVisible();
  const desktopRow = routeCards(page).first();
  const desktopBox = await desktopRow.boundingBox();
  expect(desktopBox).not.toBeNull();
  expect(desktopBox!.width).toBeLessThan(650);
  expect(desktopBox!.height).toBeLessThan(460);
  await expect(desktopRow).toContainText("Run");
  await expect(desktopRow).toContainText("21.3 km");
  await expect(desktopRow).toContainText("680 m up");
  await expect(desktopRow).toContainText("Recorded Run");
  await expect(desktopRow).toContainText(/long, exploratory Kyoto run/i);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  const mobileRow = routeCards(page).first();
  const mobileBox = await mobileRow.boundingBox();
  expect(mobileBox).not.toBeNull();
  expect(mobileBox!.width).toBeLessThanOrEqual(358);
  expect(mobileBox!.height).toBeLessThan(480);
  await expect(page.getByTestId("route-ledger-head")).toBeHidden();
});

test("search and every route filter update the URL", async ({ page }) => {
  await page.goto("/#/routes");
  const filters = page.getByRole("form", { name: "Route filters" });

  await filters.getByRole("searchbox", { name: "Search routes" }).fill("kyoto");
  await expect.poll(() => routeSearchParam(page, "q")).toBe("kyoto");

  await filters.getByRole("button", { name: "Filters", exact: true }).click();
  await filters.getByRole("combobox", { name: "Status" }).selectOption("completed");
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
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  const filters = page.getByRole("form", { name: "Route filters" });

  await expect(filters.getByRole("searchbox", { name: "Search routes" })).toHaveValue(
    "exploratory",
  );
  await expect(filters.getByRole("combobox", { name: "Status" })).toHaveValue(
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
  await page.getByRole("button", { name: "Filters", exact: true }).click();

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
  await expect(page.getByRole("heading", { name: "🍑🍑🍑🍑💦💦💦💦" })).toBeVisible();
});

test("reviewed Kyoto card opens its canonical guide and fetches only that detail", async ({
  page,
}) => {
  const detailRequests = detailRequestUrls(page);
  await page.goto("/#/routes?q=exploratory");

  const kyotoCard = routeCardWithText(page, /long, exploratory Kyoto run/i);
  await expect(kyotoCard).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Esri World Imagery", exact: true })).toBeVisible();
  await expect(kyotoCard).toContainText(/long, exploratory Kyoto run/i);
  expect(detailRequests).toEqual([]);

  const canonicalGuide = kyotoCard.getByRole("link", {
    name: "Open 🍑🍑🍑🍑💦💦💦💦 route from 2025-11-24, 21.3 km",
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

test("route cards omit badges and share one gallery imagery credit", async ({ page }) => {
  await page.goto("/#/routes?q=crosswalk+sprints");

  const draftCard = routeCardWithText(page, "Tokyo, Japan");
  await expect(draftCard).toHaveCount(1);
  await expect(draftCard).not.toContainText("Draft guide");
  await expect(draftCard).not.toContainText("AI-enhanced");
  await expect(draftCard).not.toContainText("Based on Esri imagery");
  await expect(page.getByRole("link", { name: "Esri World Imagery", exact: true })).toBeVisible();
  await expect(draftCard).not.toContainText("Reviewed");
  await expect(draftCard).not.toContainText("What it feels like");
  await expect(
    draftCard.getByRole("link", {
      name: "Open crosswalk sprints route from 2025-11-26, 21.8 km",
    }),
  ).toHaveAttribute("href", `#/routes/${draftTokyoSlug}`);
});

test("invalid and unknown filter parameters are removed from the shared URL", async ({
  page,
}) => {
  await page.goto("/#/routes?activity=NotReal&distance=nearby&junk=x");

  await expect(page).toHaveURL(/#\/routes$/);
  await expect(routeCards(page)).toHaveCount(24);
  await page.getByRole("button", { name: "Filters", exact: true }).click();
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
    await finder.getByLabel("Describe your next route").fill("Kyoto");
    await finder.getByRole("button", { name: "Edit filters", exact: true }).click();
    await finder.getByLabel("Activity").selectOption("Run");
    await finder.getByLabel("Distance").fill("21");
    await finder.getByLabel("Terrain").selectOption("mixed");
    await finder.getByLabel("Vibe").fill("exploratory climbing");
    await finder.getByRole("button", { name: "Find routes", exact: true }).click();
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
      await expect(page.getByRole("combobox", { name: "Status" })).toBeVisible();
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


test("cached cover failure leaves the recorded trace and guide usable", async ({ page }) => {
  await page.route("**/route-covers/*", route => route.abort());
  await page.goto("/#/routes?q=exploratory");
  const card = routeCards(page).first();
  await expect(card.getByRole("img", { name: /route trace/ })).toBeVisible();
  await expect(card.getByText("AI-enhanced illustration")).toHaveCount(0);
  await card.getByRole("link").click();
  await expect(page).toHaveURL(/#\/routes\/17654151284$/);
});

test("covers are cached and lazy loaded without live map or AI requests", async ({ page }) => {
  const remote: string[] = [];
  page.on("request", request => {
    if (/arcgisonline|staticmap|openai/.test(request.url())) remote.push(request.url());
  });
  await page.goto("/#/routes");
  const image = routeCards(page).first().getByRole("img");
  await expect(image).toHaveAttribute("loading", "lazy");
  await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  expect(remote).toEqual([]);
});

test("Field notes preserve original descriptions before guide summaries", async ({ page }) => {
  await page.goto("/#/routes");
  const tokyo = page.getByRole("link", { name: "Open crosswalk sprints route from 2025-11-26, 21.8 km", exact: true });
  await expect(tokyo.locator(".field-note-summary")).toHaveText("could not figure out how to cross the bridge 💀💀💀💀");
  await expect(tokyo).not.toContainText("Tokyo opens toward the water");
  const kyoto = page.getByRole("link", { name: "Open 🍑🍑🍑🍑💦💦💦💦 route from 2025-11-24, 21.3 km", exact: true });
  await expect(kyoto.locator(".field-note-summary")).toHaveText("A long, exploratory Kyoto run that moves from the city into sustained climbing before returning.");
});

for (const width of [320, 390, 768, 1280]) {
  test(`Field notes preserve every route trace within aligned imagery at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/#/routes?page=3");
    await expect(routeCards(page)).toHaveCount(67);
    await expect.poll(() => page.locator(".field-note-title").evaluateAll(titles =>
      titles.every(title => title.scrollWidth <= title.clientWidth)
    )).toBe(true);
    const violations = await page.locator(".route-cover").evaluateAll((covers, viewportWidth) => covers.flatMap((cover) => {
      const image = cover.querySelector<HTMLImageElement>(".route-cover-image")!;
      const svg = cover.querySelector<SVGSVGElement>(".route-cover-art")!;
      const line = svg.querySelector("polyline")!;
      const matrix = line.getScreenCTM()!;
      const bounds = cover.getBoundingClientRect();
      const imageBox = image.getBoundingClientRect();
      const svgBox = svg.getBoundingClientRect();
      const name = cover.closest("a")!.getAttribute("aria-label");
      const failures: string[] = [];
      // Test the rendered coordinates, so a future cover/slice regression fails
      // even when the image and route still share an identically cropped box.
      for (let i = 0; i < line.points.numberOfItems; i++) {
        const point = line.points.getItem(i);
        const rendered = new DOMPoint(point.x, point.y).matrixTransform(matrix);
        if (rendered.x < bounds.left + 8 || rendered.x > bounds.right - 8 || rendered.y < bounds.top + 8 || rendered.y > bounds.bottom - 8) {
          failures.push(`${name}: route reaches the media edge`);
          break;
        }
      }
      if (["x", "y", "width", "height"].some((key) => Math.abs(imageBox[key as keyof DOMRect] as number - (svgBox[key as keyof DOMRect] as number)) > .5)
        || getComputedStyle(image).objectFit !== "contain"
        || svg.getAttribute("preserveAspectRatio") !== "xMidYMid meet") failures.push(`${name}: image/route transforms differ`);
      if (viewportWidth <= 390 && bounds.height > 209) failures.push(`${name}: mobile media grew beyond its compact height`);
      return failures;
    }), width);
    expect(violations).toEqual([]);
    await expect.poll(() => page.locator(".route-cover-image").first().evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    await page.screenshot({ path: `e2e/evidence/field-notes-independent/routes-fixed-${width}.png` });
  });
}

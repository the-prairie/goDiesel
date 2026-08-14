import { expect, test } from "@playwright/test";

const routeSlug = "17654151284";
const importedRouteSlug = "3519505225411091950";

test("Atlas does not fetch full route records before selection", async ({ page }) => {
  const detailRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/data/routes/")) {
      detailRequests.push(request.url());
    }
  });

  await page.goto("/#/atlas");
  await expect(page.getByLabel("Interactive route globe")).toBeVisible();
  expect(detailRequests).toEqual([]);

  await page.goto(`/#/routes/${routeSlug}`);
  await expect(page.getByRole("heading", { name: "Kyoto, Japan" })).toBeVisible();
  expect(detailRequests).toHaveLength(1);
  expect(detailRequests[0]).toMatch(new RegExp(`/data/routes/${routeSlug}\\.json$`));
});

test("reviewed route story loads directly and survives refresh", async ({ page }) => {
  await page.goto(`/#/routes/${routeSlug}`);

  await expect(page.getByRole("heading", { name: "Kyoto, Japan" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Route story", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Story chapters" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Cinematic replay", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "Route story chapters" })).toBeAttached();

  const geography = page.getByRole("region", { name: "Route geography" });
  await geography.scrollIntoViewIfNeeded();
  await expect(geography).toHaveAttribute("data-map-status", "ready", {
    timeout: 15_000,
  });
  await expect(page.getByRole("img", { name: /elevation profile/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What it feels like" })).toBeVisible();
  await expect(
    page.getByLabel("Route guide").getByText(/long, exploratory Kyoto run/i),
  ).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(new RegExp(`#\/routes\/${routeSlug}$`));
  await expect(page.getByRole("heading", { name: "Kyoto, Japan" })).toBeVisible();
});

test("imported Strava route opens as a discovered guide with replay", async ({ page }) => {
  await page.goto(`/#/routes/${importedRouteSlug}`);

  await expect(
    page.getByRole("heading", { name: "breaking ankles on the Appian Way" }),
  ).toBeVisible();
  await expect(page.getByText(/Rome, Italy/i).first()).toBeVisible();
  await expect(page.getByText(/Rome, Italy · December 9, 2022/)).toBeVisible();
  await expect(page.getByText("28.5 km", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("247 m", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Story chapters" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Cinematic replay", exact: true })).toHaveAttribute(
    "href",
    `#/replay/${importedRouteSlug}?from=${encodeURIComponent(`/routes/${importedRouteSlug}`)}`,
  );
});

test("route story opens as an immersive editorial journey with recorded geography", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/#/routes/${routeSlug}`);

  const story = page.getByRole("region", { name: "Route story", exact: true });
  const hero = story.locator("section").first();
  await expect(page.getByTestId("atlas-spine")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Kyoto, Japan" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Begin the story" })).toBeVisible();
  const heroBox = (await hero.boundingBox())!;
  expect(heroBox.width).toBeGreaterThan(1300);
  expect(heroBox.height).toBeGreaterThan(600);

  const geography = page.getByRole("region", { name: "Route geography" });
  await geography.scrollIntoViewIfNeeded();
  await expect(geography).toHaveAttribute("data-map-status", "ready", {
    timeout: 15_000,
  });
  await expect(geography).toHaveAttribute("data-geometry-points", /[1-9][0-9]+/);
  await expect(geography).toHaveAttribute("data-route-color", "#315fb4");
  await expect(geography).toHaveAttribute("data-route-halo", "#f6f2e8");
  await expect(page.getByRole("complementary", { name: "Factual route briefing" })).toBeVisible();
});

test("mobile route story keeps chapters, geography, and Replay accessible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/#/routes/${routeSlug}`);

  await expect(page.getByRole("heading", { name: "Kyoto, Japan" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Story chapters" })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Route story", exact: true }).getByRole("link", {
      name: "Replay",
      exact: true,
    }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);

  const finalChapter = page.getByRole("heading", {
    name: "The recording closes",
    level: 2,
  });
  await finalChapter.scrollIntoViewIfNeeded();
  const finalChapterCard = page
    .getByRole("navigation", { name: "Story chapters" })
    .getByRole("button", { name: /The recording closes/ });
  await expect(finalChapterCard).toHaveAttribute("aria-current", "step");
  await expect(finalChapterCard).toBeVisible();

  const geography = page.getByRole("region", { name: "Route geography" });
  await geography.scrollIntoViewIfNeeded();
  await expect(geography).toHaveAttribute("data-map-status", "ready", { timeout: 15_000 });
  expect((await geography.boundingBox())!.width).toBeLessThanOrEqual(390);
});

test("route detail announces loading and retries a transient request failure", async ({
  page,
}) => {
  let requestCount = 0;
  await page.route(`**/data/routes/${routeSlug}.json`, async (route) => {
    requestCount += 1;
    if (requestCount === 1) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      await route.fulfill({ status: 500, body: "temporary failure" });
      return;
    }
    await route.continue();
  });

  await page.goto(`/#/routes/${routeSlug}`);
  await expect(page.getByRole("status")).toHaveText("Loading route story.");
  await expect(page.getByRole("alert")).toContainText("status 500");
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("heading", { name: "Kyoto, Japan" })).toBeVisible();
  expect(requestCount).toBe(2);
});

test("draft guide omits missing editorial fields and honors replay eligibility", async ({
  page,
}) => {
  await page.route(`**/data/routes/${routeSlug}.json`, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.curation = {
      vibe: "A recorded city-to-hills run.",
      review_status: "draft",
    };
    body.replay.replay_eligible = false;
    await route.fulfill({ response, json: body });
  });

  await page.goto(`/#/routes/${routeSlug}`);

  await expect(page.getByText("Guide not yet reviewed", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Cinematic replay" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Replay unavailable" })).toBeDisabled();
});

test("missing geometry disables one route without crashing detail", async ({ page }) => {
  await page.route(`**/data/routes/${routeSlug}.json`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        slug: routeSlug,
        activity_id: routeSlug,
        lifecycle: "completed",
        name: "Kyoto, Japan",
        region: "Kyoto, Japan",
        distance_km: 21.3,
        elevation_gain_m: 680,
        type: "Run",
        subtitle: "",
        activity_name: "Kyoto run",
        date: "2025-11-24",
        description: "A route without geometry.",
        completion_rule: "Complete the route.",
        difficulty: "Epic",
        theme: "Explore",
        xp: 390,
        center_lat: 35.01,
        center_lng: 135.77,
        mid_idx: 0,
        route: [],
        replay: {
          mode: "earth",
          replay_eligible: true,
          best_in_earth: true,
          geometry_status: "ready",
        },
      }),
    });
  });

  await page.goto(`/#/routes/${routeSlug}`);

  await expect(page.getByRole("heading", { name: "Kyoto run" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Replay unavailable" })).toBeDisabled();
  await expect(page.getByRole("navigation", { name: "Story chapters" })).toHaveCount(0);
  await expect(page.getByText(/Story chapters need recorded GPS geometry/)).toBeVisible();
  const geography = page.getByRole("region", { name: "Route geography" });
  await geography.scrollIntoViewIfNeeded();
  await expect(geography.getByText("Recorded path unavailable")).toBeVisible();
  await expect(page.getByText(/Elevation profile unavailable/)).toBeVisible();
});

test("source map failure preserves the route and explains the unavailable tiles", async ({
  page,
}) => {
  await page.route("https://tiles.openfreemap.org/**", (route) => route.abort());
  await page.goto(`/#/routes/${routeSlug}`);

  const geography = page.getByRole("region", { name: "Route geography" });
  await geography.scrollIntoViewIfNeeded();
  await expect(geography).toHaveAttribute("data-map-status", "unavailable", {
    timeout: 10_000,
  });
  await expect(geography.getByText("Map tiles unavailable")).toBeVisible();
  await expect(geography).toContainText("recorded route is intact");
  await expect(
    page.getByRole("link", { name: "Cinematic replay", exact: true }),
  ).toBeAttached();
});

test("route story hands off to Replay and returns to the same story", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/#/routes/${routeSlug}`);

  const replayHref = `#/replay/${routeSlug}?from=${encodeURIComponent(`/routes/${routeSlug}`)}`;
  const replay = page.locator(`a[href="${replayHref}"]`).first();
  await expect(replay).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    391,
  );

  await replay.click();
  await expect(page).toHaveURL(new RegExp(`#\/replay\/${routeSlug}\\?from=`));
  const back = page.getByRole("button", { name: "Route story" });
  await expect(back).toBeVisible();
  await back.click();
  await expect(page).toHaveURL(new RegExp(`#\/routes\/${routeSlug}$`));
});

test("changing routes never flashes the previous route detail", async ({ page }) => {
  const nextSlug = "17665674778";
  await page.goto(`/#/replay/${routeSlug}?renderer=cesium`);
  await expect(page.getByRole("heading", { name: "Kyoto, Japan" })).toBeVisible();
  await expect(page.getByText(/^21\.3 km · 680 m up$/)).toBeVisible();

  await page.route(`**/data/routes/${nextSlug}.json`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });
  await page.evaluate((slug) => {
    window.location.hash = `#/replay/${slug}?renderer=cesium`;
  }, nextSlug);

  await expect(page.getByRole("status")).toHaveText("Loading Earth Replay.");
  await expect(page.getByRole("heading", { name: "Kyoto, Japan" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Tokyo, Japan" })).toBeVisible();
  await expect(page.getByText(/^21\.8 km · 286 m up$/)).toBeVisible();
});

import { expect, test } from "@playwright/test";

const routeSlug = "17654151284";

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

test("reviewed route guide loads directly and survives refresh", async ({ page }) => {
  await page.goto(`/#/routes/${routeSlug}`);

  await expect(page.getByRole("heading", { name: "Kyoto, Japan" })).toBeVisible();
  const briefing = page.getByRole("region", { name: "Route briefing" });
  await expect(briefing).toBeVisible();
  await expect(briefing.getByRole("img", { name: /recorded path/i })).toBeVisible();
  await expect(briefing.getByRole("img", { name: /elevation profile/i })).toBeVisible();
  await expect(briefing.getByText(/680 m total climb/i)).toBeVisible();
  await expect(page.getByRole("link", { name: "Open replay" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What it feels like" })).toBeVisible();
  await expect(page.getByText(/long, exploratory Kyoto run/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Best for" })).toBeVisible();
  await expect(page.getByText(/cool-weather long-run day/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Watch for" })).toBeVisible();
  await expect(page.getByText(/current navigation conditions are not validated/i)).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(new RegExp(`#\/routes\/${routeSlug}$`));
  await expect(page.getByRole("heading", { name: "What it feels like" })).toBeVisible();
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
  await expect(page.getByRole("status")).toHaveText("Loading route details.");
  await expect(page.getByRole("alert")).toContainText("status 500");
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("heading", { name: "What it feels like" })).toBeVisible();
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

  await expect(page.getByText("Draft guide", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What it feels like" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Best for" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Watch for" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open replay" })).toHaveCount(0);
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

  await expect(page.getByRole("heading", { name: "Kyoto, Japan" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Replay unavailable" })).toBeDisabled();
  const briefing = page.getByRole("region", { name: "Route briefing" });
  await expect(briefing.getByText("Recorded path unavailable")).toBeVisible();
  await expect(briefing.getByText("Elevation profile unavailable")).toBeVisible();
});

test("route briefing fits mobile and keeps Replay prominent", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/#/routes/${routeSlug}`);

  const briefing = page.getByRole("region", { name: "Route briefing" });
  await expect(briefing).toBeVisible();
  await expect(briefing.getByText("Start", { exact: true })).toBeVisible();
  await expect(briefing.getByText("Finish", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open replay" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    391,
  );
  const briefingBox = await briefing.boundingBox();
  expect(briefingBox).not.toBeNull();
  expect(briefingBox!.x).toBeGreaterThanOrEqual(-1);
  expect(briefingBox!.x + briefingBox!.width).toBeLessThanOrEqual(391);

  await page.getByRole("link", { name: "Open replay" }).click();
  await expect(page).toHaveURL(new RegExp(`#\/replay\/${routeSlug}$`));
});

test("changing routes never flashes the previous route detail", async ({ page }) => {
  const nextSlug = "17665674778";
  await page.goto(`/#/replay/${routeSlug}`);
  await expect(page.getByRole("heading", { name: "Kyoto, Japan" })).toBeVisible();
  await expect(page.getByText(/^21\.3 km · 680 m up$/)).toBeVisible();

  await page.route(`**/data/routes/${nextSlug}.json`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });
  await page.evaluate((slug) => {
    window.location.hash = `#/replay/${slug}`;
  }, nextSlug);

  await expect(page.getByRole("status")).toHaveText("Loading Earth Replay.");
  await expect(page.getByRole("heading", { name: "Kyoto, Japan" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Tokyo, Japan" })).toBeVisible();
  await expect(page.getByText(/^21\.8 km · 286 m up$/)).toBeVisible();
});

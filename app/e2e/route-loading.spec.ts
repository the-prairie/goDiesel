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
  await expect(page.getByRole("heading", { name: "Real places, playable days." })).toBeVisible();
  expect(detailRequests).toEqual([]);

  await page.goto(`/#/routes/${routeSlug}`);
  await expect(page.getByRole("heading", { name: "Kyoto, Japan" })).toBeVisible();
  expect(detailRequests).toHaveLength(1);
  expect(detailRequests[0]).toMatch(new RegExp(`/data/routes/${routeSlug}\\.json$`));
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
        route: [],
        replay: {
          replay_eligible: true,
          geometry_status: "ready",
        },
      }),
    });
  });

  await page.goto(`/#/routes/${routeSlug}`);

  await expect(page.getByRole("heading", { name: "Kyoto, Japan" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Replay unavailable" })).toBeDisabled();
});

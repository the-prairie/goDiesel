import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const routeSlug = "17654151284";
const importedRouteSlug = "3519505225411091950";

/**
 * Read the generated record a route actually ships with.
 *
 * Asserting a hardcoded review status made this spec fail the moment a guide
 * was promoted from draft to reviewed, which is ordinary curation rather than a
 * regression. Derive the expectation instead, so the spec tracks the data.
 */
function generatedRoute(slug: string) {
  return JSON.parse(
    fs.readFileSync(
      path.resolve(process.cwd(), `public/data/routes/${slug}.json`),
      "utf8",
    ),
  ) as { activity_name: string; curation?: { review_status?: string } };
}

function guideBadge(slug: string) {
  return generatedRoute(slug).curation?.review_status === "reviewed"
    ? "Reviewed guide"
    : "Draft guide";
}

test("Atlas does not fetch full route records before selection", async ({
  page,
}) => {
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
  await expect(
    page.getByRole("heading", { name: generatedRoute(routeSlug).activity_name }),
  ).toBeVisible();
  expect(detailRequests).toHaveLength(1);
  expect(detailRequests[0]).toMatch(
    new RegExp(`/data/routes/${routeSlug}\\.json$`),
  );
});

test("reviewed route guide loads directly and survives refresh", async ({
  page,
}) => {
  await page.goto(`/#/routes/${routeSlug}`);

  await expect(
    page.getByRole("heading", { name: generatedRoute(routeSlug).activity_name }),
  ).toBeVisible();
  const briefing = page.getByRole("region", { name: "Route briefing" });
  await expect(briefing).toBeVisible();
  await expect(
    briefing.getByRole("region", { name: "Route geography" }),
  ).toBeVisible();
  await expect(
    briefing.getByRole("img", { name: /elevation profile/i }),
  ).toBeVisible();
  await expect(briefing.getByText("680 m", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open replay" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "What it feels like" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("article", { name: "Route guide" })
      .getByText(/long, exploratory Kyoto run/i),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Best for" })).toBeVisible();
  await expect(page.getByText(/cool-weather long-run day/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Watch for" })).toBeVisible();
  await expect(
    page.getByText(/current navigation conditions are not validated/i),
  ).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(new RegExp(`#\/routes\/${routeSlug}$`));
  await expect(
    page.getByRole("heading", { name: "What it feels like" }),
  ).toBeVisible();
});

test("imported Strava route opens as a discovered guide with replay", async ({
  page,
}) => {
  await page.goto(`/#/routes/${importedRouteSlug}`);

  await expect(
    page.getByRole("heading", { name: "breaking ankles on the Appian Way" }),
  ).toBeVisible();
  await expect(page.getByText("Rome, Italy", { exact: true })).toBeVisible();
  await expect(page.getByText("Discovered", { exact: true })).toBeVisible();
  await expect(
    page.getByText("December 9, 2022", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("28.5 km", { exact: true })).toBeVisible();
  await expect(page.getByText("247 m", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "What it feels like" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("article", { name: "Route guide" })
      .getByText(/urban-to-ancient-road run/i),
  ).toBeVisible();
  await expect(
    page.getByText(guideBadge(importedRouteSlug), { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Open replay" })).toHaveAttribute(
    "href",
    `#/replay/${importedRouteSlug}`,
  );
});

test("route detail is a geography-first Leaf with a bounded editorial margin", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/#/routes/${routeSlug}`);

  const geography = page.getByRole("region", { name: "Route geography" });
  const margin = page.getByRole("complementary", { name: "Route margin" });
  await expect(geography).toBeVisible();
  await expect(geography).toHaveAttribute("data-map-status", "ready", {
    timeout: 15_000,
  });
  await expect(geography).toHaveAttribute(
    "data-geometry-points",
    /[1-9][0-9]+/,
  );
  await expect(geography).toHaveAttribute("data-route-color", "#30343b");
  await expect(geography).toHaveAttribute("data-route-halo", "#ffffff");
  await expect(margin).toBeVisible();

  const geographyBox = (await geography.boundingBox())!;
  const marginBox = (await margin.boundingBox())!;
  expect(geographyBox.width).toBeGreaterThan(marginBox.width * 1.45);
  expect(
    marginBox.width / (geographyBox.width + marginBox.width),
  ).toBeGreaterThan(0.28);
  expect(marginBox.width / (geographyBox.width + marginBox.width)).toBeLessThan(
    0.4,
  );
  expect(Math.abs(geographyBox.y - marginBox.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(geographyBox.height - marginBox.height)).toBeLessThanOrEqual(
    1,
  );

  await expect(
    margin.getByRole("heading", { name: generatedRoute(routeSlug).activity_name }),
  ).toBeVisible();
  await expect(
    margin
      .getByRole("article", { name: "Route guide" })
      .getByText(/long, exploratory Kyoto run/i),
  ).toBeVisible();
  await expect(margin.getByText("21.3 km", { exact: true })).toBeVisible();
  await expect(margin.getByText("680 m", { exact: true })).toBeVisible();
  await expect(margin.getByRole("link", { name: "Open replay" })).toBeVisible();
});

test("mobile route Leaf preserves geography and Replay across sheet positions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/#/routes/${routeSlug}`);

  const geography = page.getByRole("region", { name: "Route geography" });
  const margin = page.getByRole("complementary", { name: "Route margin" });
  await expect(geography).toBeVisible();
  await expect(margin).toHaveAttribute("data-snap", "peek");
  await expect(
    margin.getByRole("heading", { name: generatedRoute(routeSlug).activity_name }),
  ).toBeVisible();
  await expect(margin.getByRole("link", { name: "Open replay" })).toBeVisible();
  await margin.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
  const mapBox = (await geography.boundingBox())!;
  expect(mapBox.height).toBeGreaterThan(400);
  expect(mapBox.y + mapBox.height).toBeLessThanOrEqual((await margin.boundingBox())!.y + 1);
  const tools = (await page.getByRole("button", { name: "Reset route map" }).boundingBox())!;
  expect(tools.y + tools.height).toBeLessThanOrEqual((await margin.boundingBox())!.y);

  await margin.getByRole("button", { name: "Expand route margin" }).click();
  await expect(margin).toHaveAttribute("data-snap", "expanded");
  await expect(
    margin.getByRole("heading", { name: "What it feels like" }),
  ).toBeVisible();
  await expect(
    margin.getByRole("img", { name: /elevation profile/i }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(391);

  await margin.getByRole("button", { name: "Collapse route margin" }).click();
  await expect(margin).toHaveAttribute("data-snap", "peek");
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
  await expect(
    page.getByRole("heading", { name: "What it feels like" }),
  ).toBeVisible();
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
  await expect(
    page.getByRole("heading", { name: "What it feels like" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Best for" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Watch for" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open replay" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Replay unavailable" }),
  ).toBeDisabled();
});

test("missing geometry disables one route without crashing detail", async ({
  page,
}) => {
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

  await expect(
    page.getByRole("heading", { name: "Kyoto run" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Replay unavailable" }),
  ).toBeDisabled();
  const briefing = page.getByRole("region", { name: "Route briefing" });
  await expect(briefing.getByText("Recorded path unavailable")).toBeVisible();
  await expect(
    briefing.getByText("Elevation profile unavailable"),
  ).toBeVisible();
});

test("source map failure preserves the route and explains the unavailable tiles", async ({
  page,
}) => {
  await page.route("https://tiles.openfreemap.org/**", (route) =>
    route.abort(),
  );
  await page.goto(`/#/routes/${routeSlug}`);

  const geography = page.getByRole("region", { name: "Route geography" });
  await expect(geography).toHaveAttribute("data-map-status", "unavailable", {
    timeout: 10_000,
  });
  await expect(geography.getByText("Map tiles unavailable")).toBeVisible();
  await expect(geography).toContainText("recorded route is intact");
  await expect(page.getByRole("link", { name: "Open replay" })).toBeVisible();
});

test("route briefing fits mobile and keeps Replay prominent", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/#/routes/${routeSlug}`);

  const briefing = page.getByRole("region", { name: "Route briefing" });
  await expect(briefing).toBeVisible();
  await expect(briefing.getByText("Start", { exact: true })).toBeVisible();
  await expect(briefing.getByText("Finish", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open replay" })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(391);
  const briefingBox = await briefing.boundingBox();
  expect(briefingBox).not.toBeNull();
  expect(briefingBox!.x).toBeGreaterThanOrEqual(-1);
  expect(briefingBox!.x + briefingBox!.width).toBeLessThanOrEqual(391);

  await page.getByRole("link", { name: "Open replay" }).click();
  await expect(page).toHaveURL(new RegExp(`#\/replay\/${routeSlug}$`));
});

test("changing routes never flashes the previous route detail", async ({
  page,
}) => {
  const nextSlug = "17665674778";
  await page.goto(`/#/replay/${routeSlug}?renderer=cesium`);
  await expect(
    page.getByRole("heading", { name: generatedRoute(routeSlug).activity_name }),
  ).toBeVisible();
  await expect(page.getByText(/^21\.3 km · 680 m up$/)).toBeVisible();

  await page.route(`**/data/routes/${nextSlug}.json`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });
  await page.evaluate((slug) => {
    window.location.hash = `#/replay/${slug}?renderer=cesium`;
  }, nextSlug);

  await expect(page.getByRole("status")).toHaveText("Loading Earth Replay.");
  await expect(page.getByRole("heading", { name: generatedRoute(routeSlug).activity_name })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("heading", { name: "crosswalk sprints" }),
  ).toBeVisible();
  await expect(page.getByText(/^21\.8 km · 286 m up$/)).toBeVisible();
});

test("narrow Leaf titles keep Open replay above the bottom navigation", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/#/routes/14080158961");
  const margin = page.getByRole("complementary", { name: "Route margin" });
  await expect(margin).toHaveAttribute("data-snap", "peek");
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await margin.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
  const replay = page.getByRole("link", { name: "Open replay", exact: true });
  const replayBox = (await replay.boundingBox())!;
  const navigationBox = (await page.getByRole("navigation", { name: "Primary" }).boundingBox())!;
  const marginBox = (await margin.boundingBox())!;
  expect(replayBox.y + replayBox.height).toBeLessThanOrEqual(navigationBox.y);
  expect(replayBox.y + replayBox.height).toBeLessThanOrEqual(marginBox.y + marginBox.height);
  await page.getByRole("button", { name: "Read guide", exact: true }).click();
  await expect(margin).toHaveAttribute("data-snap", "expanded");
  await page.getByRole("button", { name: "Collapse route margin", exact: true }).click();
  await expect(margin).toHaveAttribute("data-snap", "peek");
  await replay.click();
  await expect(page).toHaveURL(/#\/replay\/14080158961$/);
});

for (const width of [1440, 390]) {
  test(`Strava title and description survive guide curation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/#/routes/17665674778");
    const margin = page.getByRole("complementary", { name: "Route margin" });
    await expect(margin.getByRole("heading", { name: "crosswalk sprints", exact: true })).toBeVisible();
    if (width === 390) await margin.getByRole("button", { name: "Expand route margin" }).click();
    await expect(margin.getByText("could not figure out how to cross the bridge 💀💀💀💀", { exact: true })).toBeVisible();
    await expect(margin.getByRole("article", { name: "Route guide" })).toBeVisible();
    await expect(margin.getByRole("link", { name: "Open replay" })).toBeVisible();
    await page.reload();
    await expect(margin.getByRole("heading", { name: "crosswalk sprints", exact: true })).toBeVisible();
  });
}

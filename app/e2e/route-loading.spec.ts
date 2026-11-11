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
        effort_tier: "Epic",
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

test("a browser that cannot create WebGL2 keeps the guide and shows a static route trace", async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type === "webgl2") return null;
      return (getContext as (...args: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/#/routes/${routeSlug}`);

  const margin = page.getByRole("complementary", { name: "Route margin" });
  await expect(margin.getByRole("heading", { name: generatedRoute(routeSlug).activity_name })).toBeVisible();
  await expect(page.getByText("This view couldn’t open.")).toHaveCount(0);

  const geography = page.getByRole("region", { name: "Route geography" });
  await expect(geography).toHaveAttribute("data-map-status", "unavailable");
  await expect(geography.getByRole("status")).toContainText("Interactive map unavailable");
  await expect(geography.getByRole("img", { name: /recorded route trace|route trace/ }).first()).toBeVisible();
  await expect(geography.getByRole("button", { name: "Reset route map" })).toHaveCount(0);
  const traceBox = (await geography.getByRole("img", { name: /recorded route trace|route trace/ }).first().boundingBox())!;
  expect(traceBox.height).toBeGreaterThan(200);

  await expect(margin.getByRole("link", { name: "Open replay" })).toBeVisible();
  await margin.getByRole("button", { name: "Expand route margin" }).click();
  await expect(margin).toHaveAttribute("data-snap", "expanded");
  await expect(margin.getByRole("img", { name: /elevation profile/i })).toBeVisible();
  await margin.getByRole("link", { name: "Open replay" }).click();
  await expect(page).toHaveURL(new RegExp(`#\/replay\/${routeSlug}$`));
});

test("map controls stay clear of the map attribution in phone landscape", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto(`/#/routes/${routeSlug}`);
  const geography = page.getByRole("region", { name: "Route geography" });
  await expect(geography).toHaveAttribute("data-map-status", "ready", { timeout: 15_000 });

  const attribution = geography.locator(".maplibregl-ctrl-attrib");
  await attribution.evaluate((element) => { element.classList.add("maplibregl-compact-show"); element.setAttribute("open", ""); });
  await expect(attribution).toContainText("OpenStreetMap");
  const controls = (await page.getByRole("button", { name: "Reset route map" }).locator("..").boundingBox())!;
  const credits = (await attribution.boundingBox())!;
  const map = (await geography.boundingBox())!;
  const overlaps =
    controls.x < credits.x + credits.width && credits.x < controls.x + controls.width &&
    controls.y < credits.y + credits.height && credits.y < controls.y + controls.height;
  expect(overlaps).toBe(false);
  expect(credits.y + credits.height).toBeLessThanOrEqual(map.y + map.height + 1);
  expect(controls.y).toBeGreaterThanOrEqual(map.y);
});

test.describe("mobile route sheet on a touch screen", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  // Every touch carries an explicit CDP timestamp on the page's own clock, so
  // the gesture's speed is defined here and not by how fast this machine can
  // dispatch events. The sheet reads velocity from event.timeStamp, which
  // honours these stamps however late the handlers run.
  async function touchDrag(page: import("@playwright/test").Page, from: { x: number; y: number }, dy: number, { steps, stepMs, holdMs }: { steps: number; stepMs: number; holdMs: number }) {
    const cdp = await page.context().newCDPSession(page);
    const startMs = await page.evaluate(() => performance.timeOrigin + performance.now());
    const at = (ms: number) => (startMs + ms) / 1000;
    const point = (y: number) => [{ x: from.x, y, id: 1 }];
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(from.y), timestamp: at(0) });
    for (let step = 1; step <= steps; step += 1) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: point(from.y + (dy * step) / steps), timestamp: at(step * stepMs) });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [], timestamp: at(steps * stepMs + Math.max(holdMs, stepMs)) });
    await cdp.detach();
  }

  async function settled(margin: import("@playwright/test").Locator) {
    await margin.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
  }

  async function handleCenter(page: import("@playwright/test").Page) {
    const box = (await page.getByTestId("route-sheet-handle").boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  test("the grab handle drags the sheet between its stops", async ({ page }) => {
    await page.goto(`/#/routes/${routeSlug}`);
    const margin = page.getByRole("complementary", { name: "Route margin" });
    await expect(margin).toHaveAttribute("data-snap", "peek");
    await settled(margin);

    // A held drag settles at the nearest stop: 256 px + 240 px is closest to half.
    await touchDrag(page, await handleCenter(page), -240, { steps: 8, stepMs: 16, holdMs: 200 });
    await expect(margin).toHaveAttribute("data-snap", "half");
    await settled(margin);

    // A short, fast flick carries on to the next stop: 60 px in 48 ms, released 16 ms later.
    await touchDrag(page, await handleCenter(page), -60, { steps: 3, stepMs: 16, holdMs: 0 });
    await expect(margin).toHaveAttribute("data-snap", "expanded");
    await settled(margin);

    // A touch drag in the sheet's content scrolls the content, not the sheet.
    const metric = (await margin.getByText("Distance", { exact: true }).boundingBox())!;
    await touchDrag(page, { x: metric.x + metric.width / 2, y: metric.y + metric.height / 2 }, -200, { steps: 8, stepMs: 16, holdMs: 200 });
    await expect(margin).toHaveAttribute("data-snap", "expanded");
    await expect.poll(() => margin.locator(".overflow-y-auto").first().evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await settled(margin);

    // A long held drag down goes all the way back to peek.
    await touchDrag(page, await handleCenter(page), 520, { steps: 10, stepMs: 16, holdMs: 200 });
    await expect(margin).toHaveAttribute("data-snap", "peek");
    await expect(margin.getByRole("link", { name: "Open replay" })).toBeVisible();
  });

  test("position buttons say where they move the sheet", async ({ page }) => {
    await page.goto(`/#/routes/${routeSlug}`);
    const margin = page.getByRole("complementary", { name: "Route margin" });
    await expect(margin).toHaveAttribute("data-snap", "peek");
    await expect(margin.getByRole("button", { name: "Collapse route margin" })).toHaveCount(0);
    await margin.getByRole("button", { name: "Show half of route margin" }).click();
    await expect(margin).toHaveAttribute("data-snap", "half");
    await expect(margin.getByRole("button", { name: "Show half of route margin" })).toHaveCount(0);
    await margin.getByRole("button", { name: "Expand route margin" }).click();
    await expect(margin).toHaveAttribute("data-snap", "expanded");
    await margin.getByRole("button", { name: "Show half of route margin" }).click();
    await expect(margin).toHaveAttribute("data-snap", "half");
    for (const name of ["Collapse route margin", "Expand route margin"]) {
      const box = (await margin.getByRole("button", { name }).boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    const handle = (await page.getByTestId("route-sheet-handle").boundingBox())!;
    expect(handle.height).toBeGreaterThanOrEqual(44);
  });
});

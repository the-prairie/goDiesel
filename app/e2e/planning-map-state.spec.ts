import { expect, test, type Page, type Route } from "@playwright/test";

const finder = "/#/finder?place=beach&activity=Run&distance=20&q=beach";
const styleUrl = "https://tiles.openfreemap.org/styles/liberty";
const style = {
  version: 8,
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": "#263d38" } }],
};

function planningMap(page: Page) {
  return page.getByRole("region", { name: "Finder route map" });
}

async function holdStyle(page: Page) {
  let received!: (route: Route) => void;
  const pending = new Promise<Route>((resolve) => { received = resolve; });
  await page.route(styleUrl, (route) => { received(route); });
  return { pending };
}

test("planning map reaches its deadline and recovers on late readiness", async ({ page }) => {
  const { pending } = await holdStyle(page);
  await page.goto(finder);
  const request = await pending;
  await expect(planningMap(page)).toHaveAttribute("data-map-status", "loading");
  await expect(page.getByText("Opening planning map.")).toBeVisible();
  await expect(planningMap(page)).toHaveAttribute("data-map-status", "unavailable", { timeout: 10_000 });
  await expect(page.getByText("Planning map unavailable", { exact: true })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(2);
  await page.getByRole("article").last().getByRole("button", { name: "Save planned route" }).click();
  await expect(page.getByRole("article").last()).toContainText("Saved to Planned routes");
  await request.fulfill({ json: style });
  await expect(planningMap(page)).toHaveAttribute("data-map-status", "ready");
  await expect(page.getByRole("button", { name: "Fit route to map" })).toBeVisible();
  await expect(page.getByText("Planning map unavailable", { exact: true })).toHaveCount(0);
});

test("selection before load and later route changes keep map controls usable after resize", async ({ page }) => {
  const { pending } = await holdStyle(page);
  await page.goto(finder);
  const request = await pending;
  const cards = page.getByRole("article");
  await page.getByRole("button", { name: "Preview Bali, Indonesia on map" }).click();
  await expect(planningMap(page)).toHaveAttribute("data-selected-route", "9959792315");
  await request.fulfill({ json: style });
  await expect(planningMap(page)).toHaveAttribute("data-map-status", "ready");
  await page.getByRole("button", { name: "Zoom planning map in" }).click();
  await page.getByRole("button", { name: "Zoom planning map out" }).click();
  await cards.first().getByRole("button", { name: /Preview .* on map/ }).click();
  await expect(planningMap(page)).not.toHaveAttribute("data-selected-route", "9959792315");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Fit route to map" }).click();
  await expect(planningMap(page)).toHaveAttribute("data-map-status", "ready");
  const mapBox = await planningMap(page).boundingBox();
  const controlsBox = await page.getByRole("group", { name: "Finder map controls" }).boundingBox();
  expect(controlsBox!.x).toBeGreaterThanOrEqual(mapBox!.x);
  expect(controlsBox!.y + controlsBox!.height).toBeLessThanOrEqual(mapBox!.y + mapBox!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("four source failures show unavailability before the deadline", async ({ page }) => {
  const requests: Route[] = [];
  await page.route("https://planning-map.test/source-*", (route) => { requests.push(route); });
  await page.route(styleUrl, (route) => route.fulfill({ json: {
    ...style,
    sources: Object.fromEntries([0, 1, 2, 3, 4].map((id) => [`source-${id}`, {
      type: "geojson", data: `https://planning-map.test/source-${id}`,
    }])),
    layers: [0, 1, 2, 3, 4].map((id) => ({ id: `line-${id}`, type: "line", source: `source-${id}` })),
  } }));
  await page.goto(finder);
  await expect.poll(() => requests.length).toBe(5);
  for (const request of requests.slice(0, 3)) await request.abort();
  await expect(planningMap(page)).toHaveAttribute("data-map-status", "loading");
  await requests[3].abort();
  await expect(planningMap(page)).toHaveAttribute("data-map-status", "unavailable", { timeout: 2_000 });
});

test("leaving a pending map and returning starts a usable replacement", async ({ page }) => {
  const { pending } = await holdStyle(page);
  await page.goto(finder);
  const request = await pending;
  await page.getByRole("button", { name: "Discover new routes" }).click();
  await expect(planningMap(page)).toHaveCount(0);
  await page.unroute(styleUrl);
  await page.route(styleUrl, (route) => route.fulfill({ json: style }));
  await request.fulfill({ json: style }).catch(() => {});
  await page.getByRole("button", { name: "My collection · 67" }).click();
  await expect(planningMap(page)).toHaveAttribute("data-map-status", "ready");
  await page.getByRole("button", { name: "Fit route to map" }).click();
});

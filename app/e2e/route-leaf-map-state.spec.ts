import { expect, test, type Page, type Route } from "@playwright/test";

const slug = "17654151284";
const nextSlug = "17665674778";
const styleUrl = "https://tiles.openfreemap.org/styles/liberty";
const style = {
  version: 8,
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": "#263d38" } }],
};
const geography = (page: Page) => page.getByRole("region", { name: "Route geography" });

async function holdStyle(page: Page) {
  let received!: (route: Route) => void;
  const pending = new Promise<Route>((resolve) => { received = resolve; });
  await page.route(styleUrl, (route) => { received(route); });
  return pending;
}

test("Leaf deadline preserves the guide and late idle restores its map", async ({ page }) => {
  const pending = holdStyle(page);
  await page.goto(`/#/routes/${slug}`);
  const request = await pending;
  await expect(geography(page)).toHaveAttribute("data-map-status", "loading");
  await expect(page.getByText("Opening route geography.")).toBeVisible();
  await expect(geography(page)).toHaveAttribute("data-map-status", "unavailable", { timeout: 10_000 });
  await expect(page.getByText("Map tiles unavailable", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open replay" })).toBeVisible();
  await request.fulfill({ json: style });
  await expect(geography(page)).toHaveAttribute("data-map-status", "ready");
  await page.getByRole("button", { name: "Zoom route map in" }).click();
  await page.getByRole("button", { name: "Zoom route map out" }).click();
  await page.getByRole("button", { name: "Reset route map" }).click();
  await expect(page.getByText("Map tiles unavailable", { exact: true })).toHaveCount(0);
});

test("four errors fail the pending Leaf before its deadline and late idle recovers", async ({ page }) => {
  const requests: Route[] = [];
  await page.route("https://leaf-map.test/source-*", (route) => { requests.push(route); });
  await page.route(styleUrl, (route) => route.fulfill({ json: {
    ...style,
    sources: Object.fromEntries([0, 1, 2, 3, 4].map((id) => [`source-${id}`, {
      type: "geojson", data: `https://leaf-map.test/source-${id}`,
    }])),
    layers: [0, 1, 2, 3, 4].map((id) => ({ id: `line-${id}`, type: "line", source: `source-${id}` })),
  } }));
  await page.goto(`/#/routes/${slug}`);
  await expect.poll(() => requests.length).toBe(5);
  for (const request of requests.slice(0, 3)) await request.abort();
  await expect(geography(page)).toHaveAttribute("data-map-status", "loading");
  await requests[3].abort();
  await expect(geography(page)).toHaveAttribute("data-map-status", "unavailable", { timeout: 2_000 });
  await requests[4].fulfill({ json: { type: "FeatureCollection", features: [] } });
  await expect(geography(page)).toHaveAttribute("data-map-status", "ready");
});

test("replacing a pending Leaf disposes its map and loads the next recorded route", async ({ page }) => {
  const pending = holdStyle(page);
  await page.goto(`/#/routes/${slug}`);
  const request = await pending;
  await expect(geography(page)).toHaveAttribute("data-map-status", "loading");
  await page.unroute(styleUrl);
  await page.route(styleUrl, (route) => route.fulfill({ json: style }));
  await page.goto(`/#/routes/${nextSlug}`);
  await request.fulfill({ json: style }).catch(() => {});
  await expect(page.getByRole("heading", { name: "Tokyo, Japan" })).toBeVisible();
  await expect(geography(page)).toHaveAttribute("data-map-status", "ready");
  await expect(page.getByRole("img", { name: "Tokyo, Japan recorded path on a real map" })).toBeVisible();
  await page.getByRole("button", { name: "Reset route map" }).click();
  await expect(page.getByRole("heading", { name: "Kyoto, Japan" })).toHaveCount(0);
});

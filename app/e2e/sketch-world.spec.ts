import { expect, test, type Page } from "@playwright/test";

import { installGoogleReplay } from "./helpers/google-replay";

// The sketch world: the real world drawn as line work, her Kyoto routes on
// it, and the jump into Google's 3D replay. OpenFreeMap is stubbed with empty
// tiles (the sketch is then paper, her routes and the credit), and the fake
// Google engine stands in for the 3D world.

const GOLD = { slug: "17636880071", title: "i love goooooooolddddddddd" };
const PEACH = { slug: "17654151284", title: "🍑🍑🍑🍑💦💦💦💦" };

// A 1x1 transparent PNG, for the relief tiles.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

async function stubTiles(page: Page, mode: "empty" | "failing" = "empty", delayMs = 0) {
  await page.route("https://tiles.openfreemap.org/**", async (route) => {
    const url = route.request().url();
    if (mode === "failing") return route.abort();
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    if (url.endsWith("/planet"))
      return route.fulfill({
        json: {
          tilejson: "3.0.0",
          tiles: ["https://tiles.openfreemap.org/stub/{z}/{x}/{y}.pbf"],
          minzoom: 0,
          maxzoom: 14,
          vector_layers: ["water", "waterway", "landcover", "park", "boundary", "transportation", "building", "place"].map((id) => ({ id, fields: {} })),
        },
      });
    if (url.endsWith(".png")) return route.fulfill({ body: PNG, contentType: "image/png" });
    return route.fulfill({ status: 204 });
  });
}

const world = (page: Page) => page.getByTestId("sketch-world");

test("opens on the sketched world, her Kyoto routes listed exactly as written, OpenStreetMap credited", async ({ page }) => {
  await stubTiles(page);
  await page.goto("/#/lab/sketch");
  await expect(world(page)).toHaveAttribute("data-map-phase", "ready");
  await expect(page.getByRole("heading", { name: /Kyoto, sketched/ })).toBeAttached();
  const routes = page.getByTestId("sketch-routes").getByRole("button");
  await expect(routes.nth(0)).toContainText(GOLD.title);
  await expect(routes.nth(1)).toContainText(PEACH.title);
  // The map has a text alternative and the credit is shown in full.
  await expect(page.getByTestId("sketch-map").locator("canvas")).toHaveAttribute("aria-label", /sketched map/i);
  const credit = page.locator(".maplibregl-ctrl-attrib");
  await expect(credit).toBeVisible();
  await expect(credit).toContainText("OpenStreetMap contributors");
  // The owner's review control stays hidden unless asked for.
  await expect(page.getByTestId("sketch-review")).toHaveCount(0);
});

test("says it is drawing the world until the first view is drawn, on a slow connection", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await stubTiles(page, "empty", 2500);
  await page.goto("/#/lab/sketch");
  const status = page.getByTestId("sketch-status");
  await expect(status).toContainText("Drawing the world");
  await expect(world(page)).toHaveAttribute("data-map-phase", "ready", { timeout: 20_000 });
  await expect(status).toHaveCount(0);
});

test("fits a phone: 44 px targets, nothing under the credit, no sideways scroll", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await stubTiles(page);
  await page.goto("/#/lab/sketch?review=1");
  await expect(world(page)).toHaveAttribute("data-map-phase", "ready");
  for (const button of await page.locator(".sketch-key, .sketch-chip").all()) {
    const box = (await button.boundingBox())!;
    expect(box.height, await button.innerText()).toBeGreaterThanOrEqual(44);
    expect(box.width, await button.innerText()).toBeGreaterThanOrEqual(44);
  }
  const credit = (await page.locator(".maplibregl-ctrl-attrib").boundingBox())!;
  const routes = (await page.getByTestId("sketch-routes").boundingBox())!;
  expect(routes.y + routes.height).toBeLessThanOrEqual(credit.y);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("the review control switches the look and the colour reveal, kept in the link", async ({ page }) => {
  await stubTiles(page);
  await page.goto("/#/lab/sketch?review=1");
  await expect(world(page)).toHaveAttribute("data-map-phase", "ready");
  const review = page.getByTestId("sketch-review");
  await review.getByRole("button", { name: /pencil/ }).click();
  await expect(page.getByTestId("sketch")).toHaveAttribute("data-look", "pencil");
  await review.getByRole("button", { name: "Wash" }).click();
  await expect(page.getByTestId("sketch")).toHaveAttribute("data-reveal", "wash");
  await expect(page).toHaveURL(/look=pencil/);
  await expect(page).toHaveURL(/reveal=wash/);
});

test("choosing a route and jumping in hands over to the 3D replay; Back returns to the sketch at that route", async ({ page }) => {
  test.setTimeout(90_000);
  await installGoogleReplay(page, "ready");
  await stubTiles(page);
  await page.goto("/#/lab/sketch");
  await expect(world(page)).toHaveAttribute("data-map-phase", "ready");
  const gold = page.locator(`.sketch-chip[data-slug="${GOLD.slug}"]`);
  await gold.click();
  await expect(gold).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("sketch-jump").click();
  await expect(page).toHaveURL(new RegExp(`#/lab/sketch/${GOLD.slug}/3d\\?route=${GOLD.slug}$`));
  const jump = page.locator("[data-jump-phase]");
  await expect(jump).toHaveAttribute("data-jump-phase", "realm", { timeout: 30_000 });
  await expect(page.getByTestId("overland-jump")).toContainText(GOLD.title);
  // Inside, everything is drawn in the sketch's language, not the shelved pixel one.
  await expect(page.getByTestId("overland-jump")).toHaveAttribute("data-skin", "sketch");
  const box = page.getByTestId("overland-realm-text-box");
  await expect(box).toContainText(GOLD.title);
  await expect(box.locator("canvas")).toHaveCount(0);
  await expect(page.locator("[data-marker-kind]")).toHaveAttribute("data-marker-kind", "sketch-runner");
  await expect(page.getByTestId("overland-realm-controls").locator("canvas")).toHaveCount(0);
  // The sketch is out of the way and takes no input while the 3D world is up.
  await expect(page.locator(".sketch-stage")).toHaveAttribute("inert", "");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(jump).toHaveCount(0, { timeout: 30_000 });
  await expect(page).toHaveURL(new RegExp(`#/lab/sketch\\?route=${GOLD.slug}$`));
  await expect(gold).toHaveAttribute("aria-pressed", "true");
});

test("a deep link to a route not in this city is not found", async ({ page }) => {
  await stubTiles(page);
  await page.goto("/#/lab/sketch/not-a-route/3d");
  await expect(page.getByTestId("sketch")).toHaveCount(0);
});

test("when the map's tiles fail, her routes stay, with a quiet word about the map", async ({ page }) => {
  await stubTiles(page, "failing");
  await page.goto("/#/lab/sketch");
  await expect(page.getByTestId("sketch-status")).toContainText("tiles aren't loading", { timeout: 15_000 });
  await expect(page.getByTestId("sketch-routes").getByRole("button").first()).toContainText(GOLD.title);
});

// ---------------------------------------------------------------- the hand-over (S17)
// The real-geometry sketch is a stand-in here (no Google tiles in tests): a
// div that reports its first view, records its camera and colour flood, and
// counts being made and torn down.

declare global {
  interface Window {
    __realLog?: { created: number; destroyed: number; cameras: number; floods: number[]; firstView: boolean };
    __GODIESEL_SKETCH_HANDOVER_TIMEOUT_MS__?: number;
  }
}

async function fakeRealCity(page: Page, { firstView = true }: { firstView?: boolean } = {}) {
  await page.addInitScript((reportFirstView) => {
    window.__realLog = { created: 0, destroyed: 0, cameras: 0, floods: [], firstView: reportFirstView };
    window.__GODIESEL_SKETCH_HANDOVER_TIMEOUT_MS__ = 1500;
    (window as unknown as { __GODIESEL_SKETCH_REAL_FACTORY__: unknown }).__GODIESEL_SKETCH_REAL_FACTORY__ = (options: { container: HTMLElement; onFirstView: () => void }) => {
      const log = window.__realLog!;
      log.created += 1;
      const div = document.createElement("div");
      div.dataset.testid = "sketch-real-fake";
      div.style.cssText = "position:absolute;inset:0;background:#e8e2d0";
      options.container.append(div);
      if (log.firstView) setTimeout(() => options.onFirstView(), 200);
      return {
        setCamera: () => (log.cameras += 1),
        setCorridor: () => undefined,
        setFlood: (value: number) => log.floods.push(value),
        stats: () => ({ tilesetBytes: 0 }),
        destroy: () => {
          log.destroyed += 1;
          div.remove();
        },
      };
    };
  }, firstView);
}

const zoomTo = (page: Page, zoom: number) =>
  page.evaluate((z) => (window as unknown as { __sketch: { map: { jumpTo(o: object): void } } }).__sketch.map.jumpTo({ center: [135.7737, 34.9948], zoom: z, pitch: 50 }), zoom);
const handover = (page: Page) => page.getByTestId("sketch-world");

test("zooming into Kyoto hands over to the real city with a matched camera, and zooming out tears it down", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await fakeRealCity(page);
  await stubTiles(page);
  await page.goto("/#/lab/sketch");
  await expect(world(page)).toHaveAttribute("data-map-phase", "ready");
  await expect(handover(page)).toHaveAttribute("data-handover", "drawn");
  await zoomTo(page, 16.5);
  await expect(handover(page)).toHaveAttribute("data-handover", "real", { timeout: 10_000 });
  await expect(page.getByTestId("sketch-real-fake")).toBeVisible();
  const before = await page.evaluate(() => window.__realLog!.cameras);
  expect(before).toBeGreaterThan(0);
  // MapLibre stays the camera's master: the real city follows every move.
  await zoomTo(page, 16.8);
  await expect.poll(() => page.evaluate(() => window.__realLog!.cameras)).toBeGreaterThan(before);
  // Between the exit and enter zooms nothing changes; below the exit zoom it goes.
  await zoomTo(page, 14.2);
  await expect(handover(page)).toHaveAttribute("data-handover", "real");
  await zoomTo(page, 13);
  await expect(handover(page)).toHaveAttribute("data-handover", "drawn", { timeout: 10_000 });
  await expect(page.getByTestId("sketch-real-fake")).toHaveCount(0);
  expect(await page.evaluate(() => window.__realLog!)).toMatchObject({ created: 1, destroyed: 1 });
});

test("keeps the drawn city, and loads nothing, for a device saving data", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "connection", { value: { saveData: true }, configurable: true }));
  await fakeRealCity(page);
  await stubTiles(page);
  await page.goto("/#/lab/sketch");
  await expect(world(page)).toHaveAttribute("data-map-phase", "ready");
  await zoomTo(page, 16.5);
  await expect(handover(page)).toHaveAttribute("data-handover", "declined");
  await expect(handover(page)).toHaveAttribute("data-handover-reason", "save-data");
  expect(await page.evaluate(() => window.__realLog!.created)).toBe(0);
});

test("keeps the drawn city when the real city's first view is too slow, and lets it go", async ({ page }) => {
  await fakeRealCity(page, { firstView: false });
  await stubTiles(page);
  await page.goto("/#/lab/sketch");
  await expect(world(page)).toHaveAttribute("data-map-phase", "ready");
  await zoomTo(page, 16.5);
  await expect(handover(page)).toHaveAttribute("data-handover", "loading");
  await expect(handover(page)).toHaveAttribute("data-handover-reason", "slow", { timeout: 10_000 });
  await expect(page.getByTestId("sketch-real-fake")).toHaveCount(0);
  expect(await page.evaluate(() => window.__realLog!)).toMatchObject({ created: 1, destroyed: 1 });
});

test("jumping from the real city floods colour on the same geometry before the 3D replay", async ({ page }) => {
  test.setTimeout(90_000);
  await installGoogleReplay(page, "ready");
  await fakeRealCity(page);
  await stubTiles(page);
  await page.goto(`/#/lab/sketch?route=${GOLD.slug}`);
  await expect(world(page)).toHaveAttribute("data-map-phase", "ready");
  await zoomTo(page, 16.5);
  await expect(handover(page)).toHaveAttribute("data-handover", "real", { timeout: 10_000 });
  await page.getByTestId("sketch-jump").click();
  await expect(page.locator("[data-jump-phase]")).toHaveAttribute("data-jump-phase", "realm", { timeout: 30_000 });
  const floods = await page.evaluate(() => window.__realLog!.floods);
  expect(Math.max(...floods)).toBe(1);
  expect(floods.some((value) => value > 0 && value < 1)).toBe(true);
});

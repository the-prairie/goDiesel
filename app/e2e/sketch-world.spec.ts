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
// MapLibre's own chunk (named after its provider module), not its CSS or worker.
const MAPLIBRE_CHUNK = /\/assets\/maplibre-[A-Za-z0-9_-]+\.js$/;

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

// Choosing a route starts Google's Maps library loading so the dive overlaps
// it. The warm probe stands in for loadGoogleMaps + importLibrary("maps3d").
async function installWarmProbe(page: Page, saveData = false) {
  await page.addInitScript((save) => {
    const w = window as unknown as { __GODIESEL_GOOGLE_WARM__: () => Promise<void>; __warmCalls: number };
    w.__warmCalls = 0;
    w.__GODIESEL_GOOGLE_WARM__ = async () => { w.__warmCalls += 1; };
    if (save) Object.defineProperty(navigator, "connection", { value: { saveData: true }, configurable: true });
  }, saveData);
}
const warmCalls = (page: Page) => page.evaluate(() => (window as unknown as { __warmCalls: number }).__warmCalls);

test("choosing a route warms Google's 3D library once, before any jump", async ({ page }) => {
  await installWarmProbe(page);
  await stubTiles(page);
  await page.goto("/#/lab/sketch");
  await expect(world(page)).toHaveAttribute("data-map-phase", "ready");
  expect(await warmCalls(page)).toBe(0);
  await page.locator(`.sketch-chip[data-slug="${PEACH.slug}"]`).click();
  await expect.poll(() => warmCalls(page)).toBe(1);
  await page.locator(`.sketch-chip[data-slug="${GOLD.slug}"]`).click();
  await page.waitForTimeout(300);
  expect(await warmCalls(page)).toBe(1);
});

test("with Save-Data on, choosing a route loads nothing from Google until Jump in", async ({ page }) => {
  await installWarmProbe(page, true);
  await stubTiles(page);
  await page.goto("/#/lab/sketch");
  await expect(world(page)).toHaveAttribute("data-map-phase", "ready");
  await page.locator(`.sketch-chip[data-slug="${GOLD.slug}"]`).click();
  await page.waitForTimeout(500);
  expect(await warmCalls(page)).toBe(0);
});

test("her routes are listed on the paper before the map's library has arrived", async ({ page }) => {
  await stubTiles(page);
  // Hold back MapLibre's chunk: the page must not wait for it to say what it is.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(MAPLIBRE_CHUNK, async (route) => {
    await held;
    await route.continue();
  });
  await page.goto("/#/lab/sketch");
  await expect(page.getByTestId("sketch-routes").getByRole("button").first()).toContainText(GOLD.title, { timeout: 15_000 });
  await expect(page.getByTestId("sketch-status")).toContainText("Drawing the world");
  await expect(world(page)).not.toHaveAttribute("data-map-phase", "ready");
  release();
  await expect(world(page)).toHaveAttribute("data-map-phase", "ready", { timeout: 30_000 });
});

test("if the map's library cannot load, the page says so plainly and still lists her routes", async ({ page }) => {
  await stubTiles(page);
  await page.route(MAPLIBRE_CHUNK, (route) => route.abort());
  await page.goto("/#/lab/sketch");
  await expect(page.getByTestId("sketch-status")).toContainText("The map couldn't load right now", { timeout: 15_000 });
  await expect(page.getByTestId("sketch-status")).not.toContainText("WebGL");
  await expect(page.getByTestId("sketch-routes").getByRole("button").first()).toContainText(GOLD.title);
});

test("the drawn buildings round the landing are on the paper when the dive lands, even when making them is slow", async ({ page }) => {
  test.setTimeout(90_000);
  await installGoogleReplay(page, "loading");
  await stubTiles(page);
  // The building tiles (zoom 14) take 4 s each to come: slower than the dive.
  await page.route(/\/stub\/14\/\d+\/\d+\.pbf$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 4000));
    await route.fulfill({ status: 204 });
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/#/lab/sketch?route=${GOLD.slug}`);
  await expect(world(page)).toHaveAttribute("data-map-phase", "ready");
  // A viewer reads the route before jumping in.
  await page.waitForTimeout(6000);
  await page.getByTestId("sketch-jump").click();
  const atLanding = await page.waitForFunction(
    () => {
      if (document.querySelector("[data-jump-phase]")?.getAttribute("data-jump-phase") !== "holding") return null;
      const stats = (window as unknown as { __sketch: { edges(): { wanted: number; drawn: number } } }).__sketch.edges();
      return stats;
    },
    null,
    { timeout: 30_000, polling: "raf" },
  );
  const stats = (await atLanding.jsonValue()) as { wanted: number; drawn: number };
  expect(stats.wanted).toBeGreaterThan(0);
  expect(stats.drawn).toBe(stats.wanted);
});

async function intoReplay(page: Page) {
  await installGoogleReplay(page, "ready");
  await stubTiles(page);
  await page.setViewportSize({ width: 402, height: 874 });
  await page.goto(`/#/lab/sketch?route=${GOLD.slug}`);
  await expect(world(page)).toHaveAttribute("data-map-phase", "ready");
  await page.getByTestId("sketch-jump").click();
  await expect(page.locator("[data-jump-phase]")).toHaveAttribute("data-jump-phase", "realm", { timeout: 30_000 });
  return page.getByRole("group", { name: "Replay" });
}

test("in the replay the ridge is the control: one slider and a play button, Back on its own, Google's map ending where the ridge begins", async ({ page }) => {
  test.setTimeout(90_000);
  const group = await intoReplay(page);
  const ridge = group.getByRole("slider", { name: "Route progress" });
  const play = group.getByRole("button", { name: /^(Play|Pause)$/ });
  await expect(play).toHaveAccessibleName("Pause");
  await expect(group.getByRole("button", { name: "Back" })).toHaveCount(0);
  const back = page.getByRole("button", { name: "Back", exact: true });
  const leave = (await back.boundingBox())!;
  expect(leave.x).toBeLessThan(40);
  expect(leave.y).toBeLessThan(120);
  for (const box of [leave, (await play.boundingBox())!]) {
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  // Edge to edge along the bottom.
  const strip = (await ridge.boundingBox())!;
  expect(strip.x).toBe(0);
  expect(strip.width).toBe(402);
  expect(strip.y + strip.height).toBeCloseTo(874, 0);
  // Google's credit stands on its map, above the ridge, uncovered.
  const credit = (await page.getByRole("button", { name: "Provider information fixture" }).boundingBox())!;
  expect(credit.y + credit.height).toBeLessThanOrEqual(strip.y);
  await expect(page.getByRole("button", { name: "Provider information fixture" })).toBeVisible();
  // The time of day she was there, and where she stopped, from the recorded run.
  await expect(ridge).toHaveAttribute("aria-valuetext", /^\d{1,2}:\d{2} (am|pm), \d+\.\d of 32\.6 km$/);
  expect(Number(await ridge.getAttribute("data-stops"))).toBeGreaterThan(0);
});

test("the ridge moves by keyboard, arrows by 1% and shift by 5%, Home and End; Space plays and pauses; a ring only for the keyboard", async ({ page }) => {
  test.setTimeout(90_000);
  const group = await intoReplay(page);
  const play = group.getByRole("button", { name: /^(Play|Pause)$/ });
  await play.click();
  await expect(play).toHaveAccessibleName("Play");
  expect(await play.evaluate((element) => element.matches(":focus-visible"))).toBe(false);
  const ridge = group.getByRole("slider", { name: "Route progress" });
  await ridge.focus();
  await page.keyboard.press("Home");
  await expect(ridge).toHaveAttribute("aria-valuetext", /, 0\.0 of 32\.6 km$/);
  await page.keyboard.press("ArrowRight");
  await expect(ridge).toHaveAttribute("aria-valuetext", /, 0\.3 of 32\.6 km$/);
  await page.keyboard.press("Shift+ArrowRight");
  await expect(ridge).toHaveAttribute("aria-valuetext", /, 2\.0 of 32\.6 km$/);
  await page.keyboard.press("End");
  await expect(ridge).toHaveAttribute("aria-valuetext", /, 32\.6 of 32\.6 km$/);
  await page.keyboard.press("Home");
  await page.keyboard.press(" ");
  await expect(play).toHaveAccessibleName("Pause");
  await page.keyboard.press(" ");
  await expect(play).toHaveAccessibleName("Play");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.matches(":focus-visible"))).toBe(true);
});

test("on the ridge a tap of the marker plays or pauses, a touch elsewhere takes her there, and a hold opens it until release", async ({ page }) => {
  test.setTimeout(90_000);
  const group = await intoReplay(page);
  const play = group.getByRole("button", { name: /^(Play|Pause)$/ });
  const ridge = group.getByRole("slider", { name: "Route progress" });
  await play.click();
  await expect(play).toHaveAccessibleName("Play");
  // Tap the marker: plays, once.
  const marker = (await play.boundingBox())!;
  await page.mouse.click(marker.x + marker.width / 2, marker.y + marker.height / 2);
  await expect(play).toHaveAccessibleName("Pause");
  await page.mouse.click(marker.x + marker.width / 2, marker.y + marker.height / 2);
  await expect(play).toHaveAccessibleName("Play");
  // Touch a quarter of the way along: she goes there.
  const strip = (await ridge.boundingBox())!;
  await page.mouse.move(strip.x + strip.width * 0.25, strip.y + 120);
  await page.mouse.down();
  await expect(ridge).toHaveAttribute("aria-valuetext", /, 8\.\d of 32\.6 km$/);
  // Holding still opens the ridge round her; letting go settles it back.
  await expect(ridge).toHaveAttribute("data-zoomed", "true");
  // Let it open, as a thumb would before dragging.
  await page.waitForTimeout(500);
  await page.mouse.move(strip.x + strip.width * 0.25 + 80, strip.y + 120, { steps: 4 });
  await page.mouse.up();
  await expect(ridge).toHaveAttribute("data-zoomed", "false");
  // Zoomed, 80 px of drag moved her about 1.2 km, not 6.5.
  const after = Number((await ridge.getAttribute("aria-valuetext"))!.split(", ")[1].split(" ")[0]);
  expect(after).toBeGreaterThan(8.5);
  expect(after).toBeLessThan(10.5);
  await expect(play).toHaveAccessibleName("Play");
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
  // A quiet position marker with a heading, not a figure.
  await expect(page.locator("[data-marker-kind]")).toHaveAttribute("data-marker-kind", "sketch-position");
  await expect(page.locator("[data-marker-kind] [data-marker-heading]")).toHaveCount(1);
  // No pixel art here: the ridge is the sketch's own drawing.
  await expect(page.getByTestId("overland-realm-controls").locator("canvas.overland-pixels")).toHaveCount(0);
  // The sketch is out of the way and takes no input while the 3D world is up.
  await expect(page.locator(".sketch-stage")).toHaveAttribute("inert", "");
  // The cut is matched: the drawn city's camera stands where the replay's opens.
  const matched = await page.evaluate(() => {
    const target = (window as unknown as { __sketchJumpCamera: { zoom: number; pitch: number; bearing: number; fovDeg: number } }).__sketchJumpCamera;
    const map = (window as unknown as { __sketch: { map: { getZoom(): number; getPitch(): number; getBearing(): number; getVerticalFieldOfView(): number } } }).__sketch.map;
    return { target, at: { zoom: map.getZoom(), pitch: map.getPitch(), bearing: (map.getBearing() + 360) % 360, fovDeg: map.getVerticalFieldOfView() } };
  });
  expect(matched.at.zoom).toBeCloseTo(matched.target.zoom, 1);
  expect(matched.at.pitch).toBeCloseTo(matched.target.pitch, 0);
  expect(matched.at.bearing).toBeCloseTo((matched.target.bearing + 360) % 360, 0);
  expect(matched.at.fovDeg).toBeCloseTo(matched.target.fovDeg, 0);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(jump).toHaveCount(0, { timeout: 30_000 });
  await expect(page).toHaveURL(new RegExp(`#/lab/sketch\\?route=${GOLD.slug}$`));
  await expect(gold).toHaveAttribute("aria-pressed", "true");
  // Back in the drawing, close over the route's start, where its corridor shows in colour.
  await expect.poll(() => page.evaluate(() => (window as unknown as { __sketch: { map: { getZoom(): number } } }).__sketch.map.getZoom())).toBeGreaterThan(15.5);
});

test("while Google's city loads, the drawing stays up with a plain word, and Cancel returns to it", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await installGoogleReplay(page, "loading");
  await stubTiles(page);
  await page.goto(`/#/lab/sketch?route=${GOLD.slug}`);
  await expect(world(page)).toHaveAttribute("data-map-phase", "ready");
  await page.getByTestId("sketch-jump").click();
  await expect(page.locator("[data-jump-phase]")).toHaveAttribute("data-jump-phase", "holding", { timeout: 15_000 });
  await expect(page.getByTestId("overland-jump-travel")).toContainText("Loading the 3D city");
  await expect(page.locator(".sketch-stage")).toHaveAttribute("data-cover-opacity", "1");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator("[data-jump-phase]")).toHaveCount(0, { timeout: 15_000 });
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
    (window as unknown as { __GODIESEL_SKETCH_REAL_FACTORY__: unknown }).__GODIESEL_SKETCH_REAL_FACTORY__ = (options: { container: HTMLElement; onFirstView: () => void; onTilesStarted: () => void }) => {
      const log = window.__realLog!;
      log.created += 1;
      const div = document.createElement("div");
      div.dataset.testid = "sketch-real-fake";
      div.style.cssText = "position:absolute;inset:0;background:#e8e2d0";
      options.container.append(div);
      // Google's credit, as Cesium lays it out: a logo container and a two-line data line.
      const credits = document.createElement("div");
      credits.className = "cesium-viewer-bottom";
      // Cesium writes its own inline bottom offset on this box.
      credits.style.bottom = "3px";
      credits.dataset.testid = "sketch-real-credit";
      // Cesium's own stylesheet, which arrives with its lazy chunk after ours.
      if (!document.getElementById("fake-cesium-css")) {
        const css = document.createElement("style");
        css.id = "fake-cesium-css";
        css.textContent = ".cesium-viewer-bottom { display: block; position: absolute; bottom: 0; left: 0; padding-right: 5px; }";
        document.head.append(css);
      }
      credits.innerHTML = '<div class="cesium-credit-logoContainer"><span>Cesium ion</span></div><div class="cesium-widget-credits"><span>Google Maps · Google · Airbus · Data SIO, NOAA, U.S. Navy, NGA, GEBCO · Landsat / Copernicus · IBCAO</span></div>';
      div.append(credits);
      setTimeout(() => options.onTilesStarted(), 50);
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
  await page.goto("/#/lab/sketch?real=1");
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

test("browses the drawn city at every zoom: the ink hand-over to the real city is off unless the lab switch asks", async ({ page }) => {
  await fakeRealCity(page);
  await stubTiles(page);
  await page.goto("/#/lab/sketch");
  await expect(world(page)).toHaveAttribute("data-map-phase", "ready");
  await zoomTo(page, 16.5);
  await page.waitForTimeout(800);
  await expect(handover(page)).toHaveAttribute("data-handover", "drawn");
  expect(await page.evaluate(() => window.__realLog!.created)).toBe(0);
});

test("keeps the drawn city, and loads nothing, for a device saving data", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "connection", { value: { saveData: true }, configurable: true }));
  await fakeRealCity(page);
  await stubTiles(page);
  await page.goto("/#/lab/sketch?real=1");
  await expect(world(page)).toHaveAttribute("data-map-phase", "ready");
  await zoomTo(page, 16.5);
  await expect(handover(page)).toHaveAttribute("data-handover", "declined");
  await expect(handover(page)).toHaveAttribute("data-handover-reason", "save-data");
  expect(await page.evaluate(() => window.__realLog!.created)).toBe(0);
});

test("keeps the drawn city when the real city's first view is too slow, and lets it go", async ({ page }) => {
  await fakeRealCity(page, { firstView: false });
  await stubTiles(page);
  await page.goto("/#/lab/sketch?real=1");
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
  await page.goto(`/#/lab/sketch?real=1&route=${GOLD.slug}`);
  await expect(world(page)).toHaveAttribute("data-map-phase", "ready");
  await zoomTo(page, 16.5);
  await expect(handover(page)).toHaveAttribute("data-handover", "real", { timeout: 10_000 });
  await page.getByTestId("sketch-jump").click();
  await expect(page.locator("[data-jump-phase]")).toHaveAttribute("data-jump-phase", "realm", { timeout: 30_000 });
  const floods = await page.evaluate(() => window.__realLog!.floods);
  expect(Math.max(...floods)).toBe(1);
  expect(floods.some((value) => value > 0 && value < 1)).toBe(true);
});

test("on a phone, Google's two-line credit sits whole above OpenStreetMap's, with nothing over it", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await fakeRealCity(page);
  await stubTiles(page);
  await page.goto("/#/lab/sketch?real=1");
  await expect(world(page)).toHaveAttribute("data-map-phase", "ready");
  await zoomTo(page, 16.5);
  await expect(handover(page)).toHaveAttribute("data-handover", "real", { timeout: 10_000 });
  const google = (await page.getByTestId("sketch-real-credit").boundingBox())!;
  const osm = (await page.locator(".maplibregl-ctrl-attrib").boundingBox())!;
  const routes = (await page.getByTestId("sketch-routes").boundingBox())!;
  const overlaps = (a: typeof google, b: typeof google) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  expect(google.height).toBeGreaterThan(20);
  expect(google.y).toBeGreaterThanOrEqual(0);
  expect(google.y + google.height).toBeLessThanOrEqual(osm.y + 0.5);
  expect(overlaps(google, routes)).toBe(false);
  // Its whole text is inside its own box: nothing cut off below.
  const clipped = await page.getByTestId("sketch-real-credit").evaluate((element) => element.scrollHeight > element.clientHeight + 1);
  expect(clipped).toBe(false);
});

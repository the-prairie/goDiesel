import { expect, test, type Page } from "@playwright/test";

import { buildingCentre, oneBuildingTile } from "./helpers/one-building-tile";

// Planted moments in the sketch world, on the committed example only: her
// private moments folder is never used here (requests for it are refused or
// answered with a test catalog). The clip, where one is needed, is a few
// frames generated in the browser at test time.

const GOLD = "17636880071";
const EXAMPLE_NAME = "No signal (example), a planted moment";

async function stubTiles(page: Page) {
  await page.route("https://tiles.openfreemap.org/**", async (route) => {
    const url = route.request().url();
    if (url.endsWith("/planet"))
      return route.fulfill({ json: { tilejson: "3.0.0", tiles: ["https://tiles.openfreemap.org/stub/{z}/{x}/{y}.pbf"], minzoom: 0, maxzoom: 14, vector_layers: ["water", "transportation", "building"].map((id) => ({ id, fields: {} })) } });
    return route.fulfill({ status: 204 });
  });
}

/** Her folder as on a machine without it: the example stands in. */
const noPrivateMoments = (page: Page) => page.route(/\/moments\//, (route) => route.fulfill({ status: 404, body: "" }));

/** A test catalog with one clip, made now in the browser: a second of a moving square. */
async function testCatalog(page: Page) {
  const clip = await page.evaluate(async () => {
    const canvas = Object.assign(document.createElement("canvas"), { width: 64, height: 64 });
    const g = canvas.getContext("2d")!;
    const recorder = new MediaRecorder(canvas.captureStream(15), { mimeType: "video/webm" });
    const parts: Blob[] = [];
    recorder.ondataavailable = (event) => parts.push(event.data);
    recorder.start();
    for (let i = 0; i < 15; i++) {
      g.fillStyle = `hsl(${i * 24} 70% 50%)`;
      g.fillRect(0, 0, 64, 64);
      await new Promise((resolve) => setTimeout(resolve, 66));
    }
    recorder.stop();
    await new Promise((resolve) => (recorder.onstop = resolve));
    const bytes = new Uint8Array(await new Blob(parts).arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  });
  const requests: string[] = [];
  await page.route(/\/moments\//, (route) => {
    const url = route.request().url();
    requests.push(url);
    if (url.endsWith("/moments/moments.json"))
      return route.fulfill({
        json: {
          catalog: [{ id: "test", kind: "tv-wall", title: "Test clip", clip: "/moments/test.webm" }],
          placements: [{ id: "test-shop", entryId: "test", at: { lng: 135.769891, lat: 34.995784 }, facingDeg: 185 }],
        },
      });
    if (url.endsWith("/moments/test.webm")) return route.fulfill({ body: Buffer.from(clip, "base64"), contentType: "video/webm" });
    return route.fulfill({ status: 404, body: "" });
  });
  return requests;
}

const camera = (page: Page) =>
  page.evaluate(() => {
    const map = (window as unknown as { __sketch: { map: { getCenter(): { lng: number; lat: number }; getZoom(): number; getPitch(): number; getBearing(): number } } }).__sketch.map;
    const c = map.getCenter();
    return { lng: c.lng, lat: c.lat, zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
  });

async function openWorld(page: Page) {
  await stubTiles(page);
  await page.setViewportSize({ width: 402, height: 874 });
  await page.goto(`/#/lab/sketch?route=${GOLD}`);
  await expect(page.getByTestId("sketch-world")).toHaveAttribute("data-map-phase", "ready");
}

test("a planted moment stands on its building in the world, a named button, seen from city zoom", async ({ page }) => {
  await noPrivateMoments(page);
  await openWorld(page);
  const moment = page.getByRole("button", { name: EXAMPLE_NAME });
  await expect(moment).toBeVisible();
  expect(await camera(page).then((c) => c.zoom)).toBeLessThan(12);
  // Nothing of the moment's scene or clip has loaded with the world.
  await expect(page.getByTestId("moment-scene")).toHaveCount(0);
});

test("several planted moments each stand on their own spot", async ({ page }) => {
  const places = [
    { id: "one", at: { lng: 135.769891, lat: 34.995784 } },
    { id: "two", at: { lng: 135.7699, lat: 34.9967 } },
    { id: "three", at: { lng: 135.7685, lat: 34.9962 } },
  ];
  await page.route(/\/moments\//, (route) =>
    route.request().url().endsWith("/moments/moments.json")
      ? route.fulfill({ json: { catalog: [{ id: "e", kind: "tv-wall", title: "E", clip: null }], placements: places.map((p) => ({ ...p, entryId: "e", facingDeg: 185 })) } })
      : route.fulfill({ status: 404, body: "" }),
  );
  await openWorld(page);
  await page.evaluate(() => (window as unknown as { __sketch: { map: { jumpTo(o: object): void } } }).__sketch.map.jumpTo({ center: [135.7694, 34.9962], zoom: 16.5, pitch: 0, bearing: 0 }));
  await expect(page.locator(".sketch-moment")).toHaveCount(3);
  for (const place of places) {
    const where = await page.evaluate((at) => {
      const map = (window as unknown as { __sketch: { map: { project(p: [number, number]): { x: number; y: number } } } }).__sketch.map;
      const box = document.querySelector("[data-testid=sketch-map]")!.getBoundingClientRect();
      const p = map.project([at.lng, at.lat]);
      return { x: box.left + p.x, y: box.top + p.y };
    }, place.at);
    // Looking straight down, its tap target is over its own spot (a few metres onto the roof, raised).
    const r = (await page.locator(`.sketch-moment[data-moment-id="${place.id}"]`).boundingBox())!;
    expect(Math.hypot(r.x + r.width / 2 - where.x, r.y + r.height / 2 - where.y)).toBeLessThan(14);
  }
});

const MARKER = "No signal (example), a planted moment";
const viewTo = (page: Page, camera: object) =>
  page.evaluate((c) => {
    const map = (window as unknown as { __sketch: { map: { jumpTo(o: object): void; once(e: string, f: () => void): void; triggerRepaint(): void } } }).__sketch.map;
    map.jumpTo(c);
  }, camera);
/** How many frames the map draws in a second, left alone. */
const framesInASecond = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const map = (window as unknown as { __sketch: { map: { on(e: string, f: () => void): void; off(e: string, f: () => void): void } } }).__sketch.map;
        let frames = 0;
        const count = () => (frames += 1);
        setTimeout(() => {
          map.on("render", count);
          setTimeout(() => {
            map.off("render", count);
            resolve(frames);
          }, 1000);
        }, 400);
      }),
  );
const CITY = { center: [135.7698, 34.993], zoom: 12.6, pitch: 55, bearing: 0 };
const STREET = { center: [135.76985, 34.99595], zoom: 17.9, pitch: 62, bearing: 5 };

test("the marker is a beacon from city zoom and a hologram at street zoom: found by name, a 44 pt target, opening at both", async ({ page }) => {
  test.setTimeout(90_000);
  await noPrivateMoments(page);
  await openWorld(page);
  for (const camera of [CITY, STREET]) {
    await viewTo(page, camera);
    const moment = page.getByRole("button", { name: MARKER });
    await expect(moment).toBeVisible();
    const box = (await moment.boundingBox())!;
    expect([box.width, box.height]).toEqual([44, 44]);
    expect(box.x).toBeGreaterThan(0);
    expect(box.y).toBeGreaterThan(0);
    await moment.click();
    const scene = page.getByRole("dialog", { name: "No signal (example)" });
    await expect(scene).toBeVisible({ timeout: 15_000 });
    await scene.getByRole("button", { name: "Back to the street" }).click();
    await expect(scene).toHaveCount(0);
  }
});

test("the marker moves only while it is on screen, and holds still with reduced motion", async ({ page }) => {
  test.setTimeout(90_000);
  await noPrivateMoments(page);
  await openWorld(page);
  await viewTo(page, STREET);
  expect(await framesInASecond(page)).toBeGreaterThan(10);
  // Looking somewhere else: once its tiles are in, the map goes back to idle.
  await viewTo(page, { ...STREET, center: [135.74, 35.02] });
  await page.waitForFunction(() => (window as unknown as { __sketch: { map: { loaded(): boolean } } }).__sketch.map.loaded());
  await page.waitForTimeout(2500);
  expect(await framesInASecond(page)).toBeLessThanOrEqual(2);
});

test("with reduced motion the marker does not turn, bob, pulse or scan", async ({ page }) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await noPrivateMoments(page);
  await openWorld(page);
  await viewTo(page, STREET);
  await expect(page.getByRole("button", { name: MARKER })).toBeVisible();
  expect(await framesInASecond(page)).toBeLessThanOrEqual(2);
});

test("opening it takes the camera to the shop front, then the window: nine sets, muted, Sound on and off; Back returns her and focus", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("about:blank");
  const requests = await testCatalog(page);
  await openWorld(page);
  const moment = page.getByRole("button", { name: "Test clip, a planted moment" });
  await expect(moment).toBeVisible();
  expect(requests.some((url) => url.endsWith(".webm"))).toBe(false);
  const before = await camera(page);
  await moment.click();
  const scene = page.getByRole("dialog", { name: "Test clip" });
  await expect(scene).toBeVisible({ timeout: 15_000 });
  // At the shop: low, close, looking at its front (it faces 185°).
  const there = await camera(page);
  expect(there.zoom).toBeGreaterThan(18);
  expect(there.bearing).toBeCloseTo(5, 0);
  await expect(scene.getByTestId("moment-screen")).toHaveCount(9);
  // The world's own controls are gone while the moment is open: not shown, not reachable.
  for (const control of [page.getByTestId("sketch-routes"), page.getByRole("group", { name: "Where to look" }), page.getByRole("group", { name: "Map controls" })]) await expect(control).toBeHidden();
  expect(await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".sketch-ui button")].filter((b) => b.offsetParent !== null && !b.closest("[inert]")).length)).toBe(0);
  await expect(scene).toHaveAttribute("data-media", "playing", { timeout: 15_000 });
  const sound = scene.getByRole("button", { name: /^Sound (on|off)$/ });
  await expect(sound).toHaveAttribute("aria-pressed", "false");
  await sound.click();
  await expect(sound).toHaveAttribute("aria-pressed", "true");
  await sound.click();
  await expect(sound).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".moment-tv-caption")).toHaveCount(0);
  await scene.getByRole("button", { name: "Back to the street" }).click();
  await expect(scene).toHaveCount(0);
  const after = await camera(page);
  for (const key of ["lng", "lat", "zoom", "pitch", "bearing"] as const) expect(after[key]).toBeCloseTo(before[key], 5);
  // Focus goes back to the moment within a frame or two of the world waking.
  await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.momentId), { timeout: 500 }).toBe("test-shop");
  await expect(page.getByTestId("sketch-routes")).toBeVisible();
  // Escape leaves as Back does.
  await moment.click();
  await expect(scene).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("Escape");
  await expect(scene).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`route=${GOLD}`));
});

test("without a clip the sets show no signal, and there is no sound to turn on", async ({ page }) => {
  test.setTimeout(60_000);
  await noPrivateMoments(page);
  await openWorld(page);
  await page.getByRole("button", { name: EXAMPLE_NAME }).click();
  const scene = page.getByRole("dialog", { name: "No signal (example)" });
  await expect(scene).toHaveAttribute("data-media", "failed", { timeout: 15_000 });
  await expect(scene.getByTestId("moment-screen")).toHaveCount(9);
  await expect(scene.getByRole("button", { name: "Sound on" })).toBeDisabled();
});

test("with Save-Data the clip waits to be asked for", async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => Object.defineProperty(navigator, "connection", { value: { saveData: true }, configurable: true }));
  await page.goto("about:blank");
  const requests = await testCatalog(page);
  await openWorld(page);
  await page.getByRole("button", { name: "Test clip, a planted moment" }).click();
  const scene = page.getByRole("dialog", { name: "Test clip" });
  await expect(scene).toHaveAttribute("data-media", "held", { timeout: 15_000 });
  await page.waitForTimeout(500);
  expect(requests.some((url) => url.endsWith(".webm"))).toBe(false);
  await scene.getByRole("button", { name: "Play the clip" }).click();
  await expect(scene).toHaveAttribute("data-media", "playing", { timeout: 15_000 });
  expect(requests.some((url) => url.endsWith(".webm"))).toBe(true);
});

test("with reduced motion the camera and the push-in cut", async ({ page }) => {
  test.setTimeout(60_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await noPrivateMoments(page);
  await openWorld(page);
  await page.getByRole("button", { name: EXAMPLE_NAME }).click();
  const scene = page.getByRole("dialog", { name: "No signal (example)" });
  await expect(scene).toBeVisible({ timeout: 2_000 });
  await expect(scene).toHaveAttribute("data-inside", "true");
  await expect(page.locator("[data-align]")).toHaveCount(0);
});

test("the drawn shop starts where her building's front stands, then pushes in", async ({ page }) => {
  test.setTimeout(60_000);
  await noPrivateMoments(page);
  await openWorld(page);
  // Note the drawing's first frame the moment it appears, lined up.
  await page.evaluate(() => {
    const w = window as unknown as { __aligned?: object };
    new MutationObserver(() => {
      const world = document.querySelector<HTMLElement>('[data-align="aligned"]');
      if (!world || w.__aligned) return;
      const r = world.getBoundingClientRect();
      w.__aligned = { left: r.left + (r.width * 60) / 360, right: r.left + (r.width * 300) / 360, ground: r.top + (r.height * 520) / 640 };
    }).observe(document.body, { subtree: true, childList: true, attributes: true });
  });
  await page.getByRole("button", { name: EXAMPLE_NAME }).click();
  const scene = page.getByRole("dialog", { name: "No signal (example)" });
  await expect(scene).toHaveAttribute("data-inside", "true", { timeout: 15_000 });
  const drawn = (await page.evaluate(() => (window as unknown as { __aligned?: { left: number; right: number; ground: number } }).__aligned))!;
  expect(drawn).toBeTruthy();
  // The real front at the approach camera: 20 m wide, facing 185°, at the example's spot.
  const real = await page.evaluate(() => {
    const map = (window as unknown as { __sketch: { map: { project(p: [number, number]): { x: number; y: number } } } }).__sketch.map;
    const box = document.querySelector("[data-testid=sketch-map]")!.getBoundingClientRect();
    const along = ((185 + 90) * Math.PI) / 180;
    const lat = 34.995784;
    const dLng = (Math.sin(along) * 10) / (111320 * Math.cos((lat * Math.PI) / 180));
    const dLat = (Math.cos(along) * 10) / 110540;
    const a = map.project([135.769891 - dLng, lat - dLat]);
    const b = map.project([135.769891 + dLng, lat + dLat]);
    return { left: box.left + Math.min(a.x, b.x), right: box.left + Math.max(a.x, b.x), ground: box.top + (a.y + b.y) / 2 };
  });
  for (const key of ["left", "right", "ground"] as const) expect(Math.abs(drawn[key] - real[key])).toBeLessThan(2);
});

test("her catalog lists each moment with a preview and where it stands", async ({ page }) => {
  await noPrivateMoments(page);
  await page.setViewportSize({ width: 402, height: 874 });
  await page.goto("/#/lab/moments");
  const catalog = page.getByTestId("moments-catalog");
  await expect(catalog).toHaveAttribute("data-source", "example");
  const entry = catalog.getByTestId("moments-entry");
  await expect(entry).toHaveCount(1);
  await expect(entry).toContainText("No signal (example)");
  await expect(entry).toContainText("No signal");
  await expect(entry).toContainText(/Placed at 34\.99578, 135\.76989, facing S/);
});

// ---------------------------------------------------------------- review mode
// The writer (ADR-0010) stood in at its loopback address; one building to tap.

const WRITER = "http://127.0.0.1:8766";
const EXAMPLE = {
  catalog: [
    { id: "no-signal", kind: "tv-wall", title: "No signal (example)", clip: null },
    { id: "second", kind: "tv-wall", title: "Second (test)", clip: null },
  ],
  placements: [{ id: "route-064-shop", entryId: "no-signal", at: { lng: 135.769891, lat: 34.995784 }, facingDeg: 185 }],
};
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, PUT, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };

async function fakeWriter(page: Page, { available = true, refuse = false } = {}) {
  const puts: unknown[] = [];
  await page.route(`${WRITER}/**`, async (route) => {
    if (!available) return route.abort();
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (request.url().endsWith("/api/admin/status")) return route.fulfill({ headers: cors, json: { writer_available: true } });
    if (request.method() === "PUT") {
      puts.push(request.postDataJSON());
      return refuse ? route.fulfill({ status: 400, headers: cors, json: { error: "a placement names an entry that is not in the catalog" } }) : route.fulfill({ headers: cors, json: { ok: true } });
    }
    return route.fulfill({ headers: cors, json: { moments: EXAMPLE } });
  });
  return puts;
}

async function reviewWorld(page: Page) {
  const tile = oneBuildingTile();
  await page.route("https://tiles.openfreemap.org/**", async (route) => {
    const url = route.request().url();
    if (url.endsWith("/planet"))
      return route.fulfill({ json: { tilejson: "3.0.0", tiles: ["https://tiles.openfreemap.org/stub/{z}/{x}/{y}.pbf"], minzoom: 0, maxzoom: 14, vector_layers: ["water", "transportation", "building"].map((id) => ({ id, fields: {} })) } });
    if (/\/stub\/14\//.test(url)) return route.fulfill({ body: tile, contentType: "application/x-protobuf" });
    return route.fulfill({ status: 204 });
  });
  await noPrivateMoments(page);
  await page.setViewportSize({ width: 402, height: 874 });
  await page.goto(`/#/lab/sketch?route=${GOLD}&review=1`);
  await expect(page.getByTestId("sketch-world")).toHaveAttribute("data-map-phase", "ready");
  // Look straight down at the test building in the tile beside her first placement.
  const centre = buildingCentre(14370, 6490);
  await page.evaluate((c) => (window as unknown as { __sketch: { map: { jumpTo(o: object): void } } }).__sketch.map.jumpTo({ center: [c.lng, c.lat], zoom: 17.6, pitch: 0, bearing: 0 }), centre);
  await page.waitForFunction(() => (window as unknown as { __sketch: { map: { loaded(): boolean } } }).__sketch.map.loaded());
  await page.waitForTimeout(600);
  const point = await page.evaluate((c) => (window as unknown as { __sketch: { map: { project(p: [number, number]): { x: number; y: number } } } }).__sketch.map.project([c.lng, c.lat]), centre);
  const box = (await page.getByTestId("sketch-map").boundingBox())!;
  return { x: box.x + point.x, y: box.y + point.y };
}

test("in review mode away from the laptop, a tap on a building says placing works on the laptop", async ({ page }) => {
  test.setTimeout(60_000);
  await fakeWriter(page, { available: false });
  const building = await reviewWorld(page);
  await expect(page.getByTestId("moment-review")).toHaveText("Viewing only: placing works on the laptop.");
  // The phone readout: one line of plain numbers to read out or paste.
  await expect(page.getByTestId("sketch-readout")).toContainText(/frame \d+ ms average, \d+ ms worst \(last 3 s\) · tiles \d+ of \d+ drawn · last tile .+ · triangles [\d,]+ · canvas \d+×\d+ at \d+(\.\d+)?x · context lost \d+ times?/, { timeout: 5_000 });
  await expect(page.getByTestId("sketch-readout").getByRole("button", { name: "Copy" })).toBeVisible();
  await page.mouse.click(building.x, building.y);
  await expect(page.getByRole("dialog", { name: "Place a moment" })).toContainText("Placing moments works on the laptop.");
});

test("in review mode, tapping a building places a catalog entry on its street-facing side, saved through the writer", async ({ page }) => {
  test.setTimeout(60_000);
  const puts = await fakeWriter(page);
  const building = await reviewWorld(page);
  await expect(page.getByTestId("moment-review")).toHaveText("Tap a building to place a moment.");
  await page.mouse.click(building.x, building.y);
  const sheet = page.getByRole("dialog", { name: "Place a moment" });
  await sheet.getByRole("button", { name: "Second (test)" }).click();
  await expect(page.getByRole("button", { name: "Second (test), a planted moment" })).toHaveCount(1);
  await expect.poll(() => puts.length).toBe(1);
  const saved = puts[0] as typeof EXAMPLE & { placements: { entryId: string; facingDeg: number }[] };
  const placed = saved.placements.at(-1)!;
  expect(placed.entryId).toBe("second");
  // The street runs along its south side.
  expect(Math.round(placed.facingDeg)).toBe(180);
  await expect(page.getByTestId("moment-review")).toHaveAttribute("data-phase", "ready");
});

test("in review mode, tapping a placed moment swaps it or removes it", async ({ page }) => {
  test.setTimeout(60_000);
  const puts = await fakeWriter(page);
  await reviewWorld(page);
  await page.evaluate(() => (window as unknown as { __sketch: { map: { jumpTo(o: object): void } } }).__sketch.map.jumpTo({ center: [135.769891, 34.995784], zoom: 16, pitch: 0 }));
  await page.getByRole("button", { name: "No signal (example), a planted moment" }).click();
  const sheet = page.getByRole("dialog", { name: "Place a moment" });
  await sheet.getByRole("button", { name: "Swap to Second (test)" }).click();
  await expect(page.getByRole("button", { name: "Second (test), a planted moment" })).toHaveCount(1);
  await expect.poll(() => puts.length).toBe(1);
  await page.getByRole("button", { name: "Second (test), a planted moment" }).click();
  await sheet.getByRole("button", { name: "Remove from here" }).click();
  await expect(page.locator(".sketch-moment")).toHaveCount(0);
  await expect.poll(() => puts.length).toBe(2);
  expect((puts[1] as typeof EXAMPLE).placements).toEqual([]);
});

test("in review mode, a refused save keeps what she had and says so", async ({ page }) => {
  test.setTimeout(60_000);
  await fakeWriter(page, { refuse: true });
  await reviewWorld(page);
  await page.evaluate(() => (window as unknown as { __sketch: { map: { jumpTo(o: object): void } } }).__sketch.map.jumpTo({ center: [135.769891, 34.995784], zoom: 16, pitch: 0 }));
  await page.getByRole("button", { name: "No signal (example), a planted moment" }).click();
  await page.getByRole("dialog", { name: "Place a moment" }).getByRole("button", { name: "Remove from here" }).click();
  const sheet = page.getByRole("dialog", { name: "Place a moment" });
  await expect(sheet).toContainText("Not saved. Nothing was changed.");
  await expect(sheet).toContainText("a placement names an entry that is not in the catalog");
  await expect(page.getByRole("button", { name: "No signal (example), a planted moment" })).toHaveCount(1);
});

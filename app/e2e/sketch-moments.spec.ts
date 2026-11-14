import { expect, test, type Page } from "@playwright/test";

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
  expect(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.momentId)).toBe("test-shop");
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

import { expect, test } from "@playwright/test";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { syntheticGlb, syntheticRoadTile, syntheticTileset } from "./helpers/cinematic-fixture";

test.use({ launchOptions: { args: ["--enable-unsafe-swiftshader"] } });

test("real renderer draws synthetic 3D Tiles, atmosphere and MVT labels, then disposes", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  // Fail on a broken deployment asset path before a slow GPU timeout.
  for (const asset of [
    "atmosphere/scattering.bin", "atmosphere/irradiance.bin", "atmosphere/transmittance.bin",
    "clouds/local_weather.png", "clouds/shape.bin", "clouds/shape_detail.bin", "clouds/turbulence.png",
    "draco/draco_wasm_wrapper.js", "draco/draco_decoder.wasm",
  ]) expect(statSync(path.resolve("dist/world-assets", asset)).size).toBeGreaterThan(0);
  await page.setViewportSize({ width: 640, height: 480 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error" && /shader|WebGL|GL_INVALID|THREE\./i.test(message.text())) errors.push(message.text()); });
  await page.route("https://tile.googleapis.com/**", async (request) => {
    if (request.request().url().includes("root.json")) await request.fulfill({ json: syntheticTileset() });
    else await request.fulfill({ contentType: "model/gltf-binary", body: syntheticGlb() });
  });
  await page.route("https://tiles.openfreemap.org/**", async (request) => {
    const match = /fixture\/(\d+)\/(\d+)\/(\d+)\.pbf/.exec(request.request().url());
    if (match) await request.fulfill({ contentType: "application/x-protobuf", body: syntheticRoadTile(Number(match[1]), Number(match[2]), Number(match[3])) });
    else await request.fulfill({ json: { maxzoom: 14, tiles: ["https://tiles.openfreemap.org/fixture/{z}/{x}/{y}.pbf"] } });
  });
  await page.goto("/#/replay/14130782031");
  const runtime = readdirSync(path.resolve("dist/assets")).find((name) => /^cinematic-world-engine-.*\.js$/.test(name));
  expect(runtime).toBeTruthy();
  await page.evaluate(async (url) => {
    const module = await import(/* @vite-ignore */ url);
    const engine = module.createCinematicWorldEngine();
    const container = document.createElement("div");
    container.id = "real-renderer-fixture";
    container.style.cssText = "position:fixed;inset:0;z-index:100;background:#101010;--world-dock-height:0px";
    document.body.append(container);
    const state = window as unknown as { __realWorld: typeof engine; __realWorldContainer: HTMLElement };
    state.__realWorld = engine; state.__realWorldContainer = container;
    engine.setEnvironment({ light: "daylight", clouds: 0, labels: true, quality: "light", reducedMotion: false });
    await engine.mount({
      apiKey: "synthetic-test-only-not-a-provider-key", container,
      groundingMode: "mesh",
      initialCamera: { center: { lat: 51, lng: -114, altitude: 1000 }, headingDeg: 0, rangeM: 2400, tiltDeg: 65, fovDeg: 54, progressM: 0 },
      route: {
        slug: "synthetic-renderer-test", name: "Synthetic renderer test", lifecycle: "completed", distanceKm: 2,
        centerLat: 51, centerLng: -114, elevationStatus: "recorded",
        replay: { replayEligible: true, geometryStatus: "ready" },
        route: [{ lat: 51, lng: -114.01, elev: 1000, d: 0 }, { lat: 51, lng: -114, elev: 1000, d: 1000 }, { lat: 51, lng: -113.99, elev: 1000, d: 2000 }],
        provenance: { discontinuities: [], elevation: { status: "recorded" } },
      },
      onStatus: (status: { state: string; message: string }) => { container.dataset.engineStatus = status.state; container.dataset.message = status.message; },
    });
    const caption = document.createElement("div");
    caption.textContent = "SYNTHETIC PIPELINE TEST — NOT LIVE IMAGERY";
    caption.style.cssText = "position:absolute;top:8px;left:8px;padding:6px;background:#fff;color:#111;font:11px Arial";
    container.append(caption);
    engine.setCinematicRoute({ startRatio: 0, endRatio: 1, focusRatio: 0.5, rangeM: 2400, motionIntensity: 1, shotKind: "tracking" });
  }, `/assets/${runtime}`);
  const world = page.locator("#real-renderer-fixture");
  await expect(world).toHaveAttribute("data-world-terrain", "ready", { timeout: 45_000 });
  await expect(world).toHaveAttribute("data-world-atmosphere", "ready", { timeout: 45_000 });
  await expect.poll(async () => Number(await world.getAttribute("data-rendered-tile-meshes"))).toBeGreaterThan(0);
  await expect.poll(async () => Number(await world.getAttribute("data-world-label-count")), { timeout: 30_000 }).toBeGreaterThan(0);
  // With normal motion, the road name must fade in promptly and remain readable below
  // the terrain baseline. A visible-label count alone misses clipped or 200-second fades.
  await expect.poll(async () => {
    const frame = PNG.sync.read(await page.screenshot());
    let lowerGlyphPixels = 0;
    for (let y = 241; y < 253; y++) for (let x = 230; x < 412; x++) {
      const i = (y * frame.width + x) * 4;
      if (frame.data[i] < 135 && frame.data[i + 1] < 135 && frame.data[i + 2] < 135) lowerGlyphPixels++;
    }
    return lowerGlyphPixels;
  }, { timeout: 8000 }).toBeGreaterThan(25);
  await page.screenshot({ path: testInfo.outputPath("real-pipeline-synthetic-daylight.png") });
  await page.evaluate(() => {
    (window as unknown as { __realWorld: { setEnvironment(value: unknown): void } }).__realWorld.setEnvironment({ light: "golden", clouds: 0.55, labels: true, quality: "balanced", reducedMotion: true });
  });
  // Let the real volumetric pass draw, then assert no shader/runtime errors rather than masking them.
  await page.waitForTimeout(2500);
  await expect(world).toHaveAttribute("data-world-atmosphere", "ready");
  const golden = PNG.sync.read(await page.screenshot({ path: testInfo.outputPath("real-pipeline-synthetic-golden-clouds.png") }));
  // The route is centered by the recorded camera pose. Clouds must not erase its coral trace.
  let routePixels = 0;
  for (let y = 230; y < 246; y++) for (let x = 180; x < 440; x++) {
    const i = (y * golden.width + x) * 4;
    if (golden.data[i] > 100 && golden.data[i] > golden.data[i + 1] * 1.3 && golden.data[i] > golden.data[i + 2] * 1.3) routePixels++;
  }
  expect(routePixels).toBeGreaterThan(3);
  expect(errors).toEqual([]);
  await page.evaluate(() => {
    const element = document.querySelector<HTMLCanvasElement>("#real-renderer-fixture canvas")!;
    element.getContext("webgl2")!.getExtension("WEBGL_lose_context")!.loseContext();
  });
  await expect(world).toHaveAttribute("data-engine-status", "unavailable");
  await page.evaluate(() => (window as unknown as { __realWorld: { destroy(): void } }).__realWorld.destroy());
  await expect(world.locator("canvas")).toHaveCount(0);
});

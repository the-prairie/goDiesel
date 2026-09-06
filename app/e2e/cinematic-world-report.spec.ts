import { expect, test, type Page } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parseRouteDetail } from "../src/domain/route";
import type { WorldDiagnostics } from "../src/surfaces/replay/world/world-diagnostics";
import { syntheticGlb, syntheticRoadTile, syntheticTileset } from "./helpers/cinematic-fixture";

test.use({ launchOptions: { args: ["--enable-unsafe-swiftshader"] } });
async function report(page: Page): Promise<WorldDiagnostics> {
  return page.evaluate(() => {
    const detail = { report: null };
    document.querySelector("[data-world-terrain]")!.dispatchEvent(new CustomEvent("godiesel:world-diagnostics", { detail }));
    return detail.report!;
  });
}

test("real renderer and owning controls export a minute of synthetic playback with context and session totals", async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  page.setDefaultTimeout(15_000);
  testInfo.annotations.push({ type: "evidence", description: "Real controller/renderer, explicitly synthetic route and tiles; not live imagery or hardware acceptance." });
  await page.setViewportSize({ width: 1280, height: 720 });
  const record = JSON.parse(readFileSync("public/data/routes/14130782031.json", "utf8"));
  Object.assign(record, {
    name: "Synthetic report journey", activity_name: "SYNTHETIC REPORT TEST — NOT LIVE IMAGERY",
    region: "Synthetic pipeline", center_lat: 51, center_lng: -114, distance_km: 2, mid_idx: 20,
    route: Array.from({ length: 41 }, (_, i) => ({ lat: 51, lng: -114.01 + i * 0.0005, elev: 1000, d: i * 50, elapsed_s: i * 20 })),
  });
  record.provenance.discontinuities = [];
  record.replay.point_count = record.route.length;
  expect(parseRouteDetail(record).replay.replayEligible).toBe(true);
  await page.route("**/data/routes/14130782031.json", request => request.fulfill({ json: record }));
  await page.route("https://tile.googleapis.com/**", request => request.request().url().includes("root.json")
    ? request.fulfill({ json: syntheticTileset() })
    : request.fulfill({ contentType: "model/gltf-binary", body: syntheticGlb() }));
  await page.route("https://tiles.openfreemap.org/**", request => {
    const match = /fixture\/(\d+)\/(\d+)\/(\d+)\.pbf/.exec(request.request().url());
    return match ? request.fulfill({ contentType: "application/x-protobuf", body: syntheticRoadTile(+match[1], +match[2], +match[3]) })
      : request.fulfill({ json: { maxzoom: 14, tiles: ["https://tiles.openfreemap.org/fixture/{z}/{x}/{y}.pbf"] } });
  });
  await page.goto("/#/routes");
  const runtime = readdirSync(path.resolve("dist/assets")).find(name => /^cinematic-world-engine-.*\.js$/.test(name));
  expect(runtime).toBeTruthy();
  await page.evaluate(async url => {
    const module = await import(/* @vite-ignore */ url);
    // This is the ACTUAL renderer. Only its credential and data are synthetic.
    const engine = module.createCinematicWorldEngine();
    const mount = engine.mount.bind(engine);
    engine.mount = (options: object) => mount({ ...options, apiKey: "synthetic-credential-canary-never-export" });
    window.__GODIESEL_CINEMATIC_WORLD_FACTORY__ = () => engine;
    location.hash = "/replay/14130782031?renderer=cinematic";
  }, `/assets/${runtime}`);
  const world = page.locator("[data-world-terrain]");
  await expect(world).toHaveAttribute("data-world-terrain", "ready", { timeout: 45_000 });
  await page.getByRole("button", { name: "Chase", exact: true }).press("Enter");
  await page.getByRole("button", { name: "Play route", exact: true }).press("Enter");
  await expect.poll(async () => (await report(page)).playback?.playing).toBe(true);
  // Ordinary keyboard activation retains focus on the playback control.
  // HUD auto-hide is covered separately; this is a recording contract test.
  // Real elapsed time, no mocked clock. More playback must produce more history.
  await page.waitForTimeout(61_000);
  await page.getByRole("button", { name: "Pause route", exact: true }).press("Enter");
  await expect.poll(async () => (await report(page)).playback?.playing).toBe(false);
  await page.getByRole("slider", { name: "Route progress", exact: true }).press("ArrowRight");
  const canvas = page.getByTestId("cinematic-world-canvas");
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 480, box.y + 340); await page.mouse.down();
  await page.mouse.move(box.x + 540, box.y + 360, { steps: 5 }); await page.mouse.up();
  await expect.poll(async () => (await report(page)).camera.owner).toBe("free");
  await page.getByRole("button", { name: "Recenter route", exact: true }).click();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.getByRole("button", { name: "Replay settings", exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save playback report", exact: true }).click();
  const downloaded = await downloading;
  const output = testInfo.outputPath("synthetic-minute-report.json"); await downloaded.saveAs(output);
  const saved: WorldDiagnostics = JSON.parse(readFileSync(output, "utf8"));
  expect(saved.schema).toBe("godiesel-world-report-v2");
  expect(saved.frames.windowMs).toBeGreaterThan(59_000);
  expect(saved.frames.retention.truncated).toBe(false);
  expect(saved.frames.byActivity.playing.samples).toBeGreaterThan(0);
  expect(saved.session.elapsedMs).toBeGreaterThan(61_000);
  expect(saved.session.frames.samples).toBeGreaterThanOrEqual(saved.frames.samples);
  expect(saved.session.renderSubmissions).toBeGreaterThan(0);
  expect(saved.timeline.length).toBeGreaterThan(30);
  expect(saved.playback).toMatchObject({ playing: false, cameraMode: "overview", following: true, settingsOpen: true });
  expect(saved.camera.actualRangeM).toBeGreaterThan(0);
  expect(saved.events.entries.map(event => event.kind)).toEqual(expect.arrayContaining(["play", "pause", "seek", "camera-mode", "free-camera", "recenter", "settings-open"]));
  expect(saved.build.revision).toMatch(/^[a-f0-9]{40}$/);
  expect(saved.terrain.focus.reason).not.toBe("not-sampled");
  expect(readFileSync(output, "utf8")).not.toMatch(/synthetic-credential-canary|https?:\/\/|"(?:lat|lng|center|apiKey|url)"/);
  await page.screenshot({ path: testInfo.outputPath("synthetic-report-settings.png") });
  await page.getByRole("button", { name: "Route story", exact: true }).click();
  await expect(page.locator("[data-world-terrain]")).toHaveCount(0);
});

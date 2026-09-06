import { expect, test, type Page, type TestInfo } from "@playwright/test";
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

async function mountReportFixture(page: Page, testInfo: TestInfo) {
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
}

async function downloadReport(page: Page, testInfo: TestInfo, filename: string) {
  await page.getByRole("button", { name: "Replay settings", exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save playback report", exact: true }).click();
  const downloaded = await downloading;
  const output = testInfo.outputPath(filename);
  await downloaded.saveAs(output);
  const text = readFileSync(output, "utf8");
  const saved: WorldDiagnostics = JSON.parse(text);
  expect(saved.schema).toBe("godiesel-world-report-v2");
  expect(saved.session.renderSubmissions).toBeGreaterThan(0);
  expect(saved.camera.actualRangeM).toBeGreaterThan(0);
  expect(saved.build.revision).toMatch(/^[a-f0-9]{40}$/);
  expect(saved.terrain.focus.reason).not.toBe("not-sampled");
  expect(text).not.toMatch(/synthetic-credential-canary|https?:\/\/|"(?:lat|lng|center|apiKey|url)"/);
  return saved;
}

// Retention and interaction/lifecycle are independent contracts. Combining a real
// minute wait with every pointer action consumed the overall deadline on software
// rendering after the report had already passed. Keep both, without longer timeouts.
test("real renderer exports a full minute of synthetic playback and independent session totals", async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  await mountReportFixture(page, testInfo);
  await page.getByRole("button", { name: "Chase", exact: true }).press("Enter");
  await page.getByRole("button", { name: "Play route", exact: true }).press("Enter");
  await expect.poll(async () => (await report(page)).playback?.playing).toBe(true);
  // Real elapsed time, no mocked clock. Ordinary keyboard activation retains focus;
  // HUD auto-hide and pointer responsiveness remain covered by their separate gates.
  await page.waitForTimeout(61_000);
  await page.getByRole("button", { name: "Pause route", exact: true }).press("Enter");
  await expect.poll(async () => (await report(page)).playback?.playing).toBe(false);
  const saved = await downloadReport(page, testInfo, "synthetic-minute-report.json");
  expect(saved.frames.windowMs).toBeGreaterThan(59_000);
  expect(saved.frames.retention.truncated).toBe(false);
  expect(saved.frames.byActivity.playing.samples).toBeGreaterThan(0);
  expect(saved.session.elapsedMs).toBeGreaterThan(61_000);
  expect(saved.session.frames.samples).toBeGreaterThanOrEqual(saved.frames.samples);
  expect(saved.timeline.length).toBeGreaterThan(30);
  expect(saved.playback).toMatchObject({ playing: false, cameraMode: "chase", following: true, settingsOpen: true });
  expect(saved.events.entries.map(event => event.kind)).toEqual(expect.arrayContaining(["play", "pause", "camera-mode", "settings-open"]));
  await page.screenshot({ path: testInfo.outputPath("synthetic-minute-settings.png") });
});

test("real controls record seek, free camera and recenter in the download, then release the renderer", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await mountReportFixture(page, testInfo);
  await page.getByRole("button", { name: "Chase", exact: true }).press("Enter");
  await page.getByRole("button", { name: "Play route", exact: true }).press("Enter");
  await expect.poll(async () => (await report(page)).playback?.playing).toBe(true);
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
  const saved = await downloadReport(page, testInfo, "synthetic-context-report.json");
  expect(saved.playback).toMatchObject({ playing: false, cameraMode: "overview", following: true, settingsOpen: true });
  expect(saved.events.entries.map(event => event.kind)).toEqual(expect.arrayContaining(["play", "pause", "seek", "camera-mode", "free-camera", "recenter", "settings-open"]));
  await page.screenshot({ path: testInfo.outputPath("synthetic-context-settings.png") });
  await page.getByRole("button", { name: "Route story", exact: true }).click();
  await expect(page.locator("[data-world-terrain]")).toHaveCount(0);
});

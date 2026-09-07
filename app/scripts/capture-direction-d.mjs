/**
 * Unedited, live-terrain journey evidence. Uses the installed Playwright recorder.
 * BASE=http://localhost:8789 JOURNEYS=desktop,mobile,kyoto node scripts/capture-direction-d.mjs
 * OUT defaults to ignored /tmp/direction-d-continuation. HEADLESS=1 is
 * software/emulated proof; the default macOS window uses the available GPU.
 */
import { chromium } from "@playwright/test";
import { mkdir, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

const BASE = process.env.BASE ?? "http://localhost:8787";
const OUT = path.resolve(process.env.OUT ?? "/tmp/direction-d-continuation");
const names = (process.env.JOURNEYS ?? "desktop,mobile,kyoto").split(",");
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ headless: process.env.HEADLESS === "1" || process.platform !== "darwin" });
const results = [];
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function ready(page) {
  await page.locator('[data-terrain-state="ready"]').first().waitFor({ timeout: 45000 });
  await page.waitForTimeout(1200);
}
async function snapshot(page, name) { await page.screenshot({ path: path.join(OUT, `${name}.png`) }); }

async function journey(name) {
  const mobile = name === "mobile";
  const kyoto = name === "kyoto";
  const slug = kyoto ? "17654151284" : "15573295095";
  const region = kyoto ? "Kyoto, Japan" : "Banff/Kananaskis";
  const viewport = mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 };
  const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile,
    recordVideo: { dir: OUT, size: viewport },
  });
  const page = await context.newPage();
  const videoStart = Date.now();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const evidence = { journey: name, route: slug, viewport, errors, checks: [] };
  const check = (ok, message) => { assert(ok, message); evidence.checks.push(message); console.log(`ok ${name}: ${message}`); };
  try {
    await page.goto(`${BASE}/#/lab/design-seeds/d/atlas?region=${encodeURIComponent(region)}&route=${slug}`);
    await ready(page);
    await snapshot(page, `${name}-region`);
    if (mobile) await page.locator(`a[href*="/d/story/${slug}"]`).first().click();
    else await page.getByRole("link", { name: "Enter this day", exact: true }).click();
    await ready(page);
    await snapshot(page, `${name}-day`);
    if (kyoto) {
      check(await page.locator("figure img").evaluate(img => img.complete && img.naturalWidth > 0), "real photograph is readable without scrubbing");
      const photos = page.getByRole("button", { name: /^Open photograph:/ });
      check(await photos.count() === 2, "both recorded photographs are directly available");
      await photos.nth(1).click();
      await page.waitForTimeout(900);
      await photos.first().click();
    } else {
      const ribbon = page.locator(".seed-ribbon");
      const box = await ribbon.boundingBox();
      if (mobile) {
        await page.touchscreen.tap(box.x + box.width * 0.48, box.y + box.height / 2);
        const thumb = await page.locator(".seed-ribbon-thumb").boundingBox();
        const cdp = await context.newCDPSession(page);
        const x = thumb.x + thumb.width / 2, y = thumb.y + thumb.height / 2;
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
        for (let step = 1; step <= 10; step++) {
          await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + step * 2.5, y: y - step }] });
          await page.waitForTimeout(35);
        }
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      } else {
        await ribbon.click({ position: { x: box.width * 0.55, y: box.height / 2 } });
        const handle = page.locator(".seed-thread-grab");
        await handle.focus();
        await handle.press("ArrowRight");
        await handle.press("ArrowLeft");
      }
    }
    await page.waitForTimeout(1000);
    const held = Number(await page.locator(".seed-ribbon").getAttribute("aria-valuenow"));
    const value = await page.locator(".seed-ribbon").getAttribute("aria-valuetext");
    check(value === await page.locator(".seed-thread-grab").getAttribute("aria-valuetext"), "map and profile share the selected position");
    await snapshot(page, `${name}-held`);
    const title = await page.locator("h1").innerText();
    const world = await page.locator("[data-relief-world]").getAttribute("data-relief-world");
    await page.evaluate(async () => {
      const map = window.__reliefMap;
      const at = (await map.getSource("relief-position").getData()).features[0].geometry.coordinates;
      window.__directionDCanvas = map.getCanvas();
      window.__directionDFrames = [];
      window.__directionDFrameListener = () => {
        const point = map.project(at);
        const eye = map.transform.getCameraLngLat();
        const elevation = map.queryTerrainElevation(eye);
        window.__directionDFrames.push({ time: performance.now(), x: point.x, y: point.y,
          pitch: map.getPitch(), zoom: map.getZoom(), targetElevation: map.getCenterElevation(),
          clearance: elevation === null ? null : map.transform.getCameraAltitude() - elevation });
      };
      map.on("move", window.__directionDFrameListener);
    });
    evidence.entryVideoSeconds = (Date.now() - videoStart) / 1000;
    await page.getByRole("button", { name: /^Enter at/ }).click();
    await page.getByTestId("replay-stage").waitFor();
    const frames = await page.evaluate(() => {
      window.__reliefMap.off("move", window.__directionDFrameListener);
      return window.__directionDFrames;
    });
    evidence.descentFrames = frames;
    await writeFile(path.join(OUT, `${name}-descent.json`), JSON.stringify(frames, null, 2));
    check(frames.length >= 3, "the descent has observed intermediate frames");
    check(frames.every(f => f.x >= 20 && f.x <= viewport.width - 20 && f.y >= 20 && f.y <= viewport.height - 20), "the held point remains inside the viewport throughout descent");
    check(frames.every(f => f.clearance === null || f.clearance > 60), "the sampled camera position clears terrain throughout descent");
    check(world === await page.locator("[data-relief-world]").getAttribute("data-relief-world"), "Replay owns the same terrain world");
    check(await page.evaluate(() => document.querySelector(".maplibregl-canvas") === window.__directionDCanvas), "the loaded canvas survives the handover");
    check(await page.locator(".maplibregl-canvas").count() === 1, "there is one rendered world");
    const stage = page.getByTestId("replay-stage");
    check(Number(await stage.getAttribute("data-progress")) === held, `initial Replay position is exactly ${held} metres`);
    check(await page.locator("h1").innerText() === title, "the personal title survives entry");
    await page.waitForTimeout(800);
    const marker = await page.locator(".relief-world-position").boundingBox();
    check(marker && marker.x > viewport.width * 0.2 && marker.x < viewport.width * 0.8 && marker.y > 120 && marker.y < viewport.height - (mobile ? 220 : 150), "arrival places the held point in the open landscape");
    const boxes = await page.locator("[data-slot=button]:visible").evaluateAll(elements => elements.map(el => ({ label: el.getAttribute("aria-label") || el.textContent, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height })));
    evidence.applicationControls = boxes;
    check(boxes.every(box => box.width >= (mobile ? 48 : 44) && box.height >= (mobile ? 48 : 44)), "application controls meet the required minimum target");
    await snapshot(page, `${name}-arrival`);
    await page.getByRole("button", { name: "Play route", exact: true }).click();
    await page.waitForTimeout(5000);
    await page.getByRole("button", { name: "Pause route", exact: true }).click();
    const paused = Number(await stage.getAttribute("data-progress"));
    check(paused > held + 25, "playback visibly advances");
    await page.waitForTimeout(1000);
    check(Number(await stage.getAttribute("data-progress")) === paused, "pause holds its position");
    await snapshot(page, `${name}-paused`);
    await page.getByRole("link", { name: "Route story", exact: true }).click();
    await page.locator(".seed-ribbon").waitFor();
    await page.waitForTimeout(2500);
    evidence.returnTerrainState = await page.locator("[data-terrain-state]").first().getAttribute("data-terrain-state");
    check(await page.locator(".seed-ribbon").getAttribute("aria-valuetext") === value, "visible return restores inspection");
    if (kyoto) check(await page.locator("figure img").getAttribute("alt") === "Stone stairway", "return restores the photograph");
    await snapshot(page, `${name}-returned`);
    if (!kyoto) {
      await page.goBack();
      await stage.waitFor();
      check(Number(await stage.getAttribute("data-progress")) === held, "browser Back preserves Replay entry distance");
      await page.goForward();
      await ready(page);
      check(await page.locator(".seed-ribbon").getAttribute("aria-valuetext") === value, "browser Forward restores the held thread");
    }
    await page.locator("header a").first().click();
    check(page.url().includes("/d/atlas"), "visible return reaches the original region");
    check(errors.length === 0, "no application errors");
    evidence.result = "passed";
  } catch (error) {
    evidence.result = "failed";
    evidence.error = String(error);
    await snapshot(page, `${name}-failure`).catch(() => {});
    console.error(`${name}: ${error}`);
  } finally {
    const video = page.video();
    await context.close();
    if (video) await rename(await video.path(), path.join(OUT, `${name}-journey.webm`));
    results.push(evidence);
  }
}

try { for (const name of names) await journey(name); }
finally { await browser.close(); }
const report = { commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  dirty: execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim() !== "", base: BASE,
  providers: ["OpenFreeMap Liberty", "Mapzen Terrain Tiles"], googleImagery: "not exercised", realDeviceTouch: "not exercised", results };
await writeFile(path.join(OUT, "journeys.json"), JSON.stringify(report, null, 2));
console.log(`Evidence: ${OUT}`);
process.exitCode = results.every(result => result.result === "passed") ? 0 : 1;

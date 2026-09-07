/** Direct route dragging and emulated phone reading scroll, with real terrain. */
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const BASE = process.env.BASE ?? "http://localhost:8787";
const OUT = process.env.OUT ?? "/tmp/direction-d-resilience";
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ headless: process.env.HEADLESS === "1" || process.platform !== "darwin" });
const checks = [];
const check = (ok, name, detail) => {
  checks.push({ ok, name, detail });
  console.log(ok ? "ok" : "FAIL", name, detail ?? "");
};
const ready = page => page.locator('[data-terrain-state="ready"]').first().waitFor({ timeout: 60000 });

try {
  for (const [slug, at, label] of [
    ["15573295095", 10000, "Banff switchbacks"],
    ["15182597704", 22000, "Calgary overlapping laps"],
  ]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto(`${BASE}/#/lab/design-seeds/d/story/${slug}?at=${at}`);
    await ready(page);
    await page.waitForTimeout(1600);
    const handle = page.locator(".seed-thread-grab");
    const box = await handle.boundingBox();
    const start = Number(await handle.getAttribute("aria-valuenow"));
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2 - 8, { steps: 8 });
    await page.mouse.up();
    const end = Number(await handle.getAttribute("aria-valuenow"));
    const alignment = await page.evaluate(async () => {
      const map = window.__reliefMap;
      const at = (await map.getSource("relief-position").getData()).features[0].geometry.coordinates;
      const point = map.project(at), back = map.unproject(point);
      const marker = document.querySelector(".relief-world-position").getBoundingClientRect();
      return {
        rayErrorM: Math.hypot((back.lng - at[0]) * Math.cos(at[1] * Math.PI / 180), back.lat - at[1]) * 111320,
        markerErrorPx: Math.hypot(marker.x + marker.width / 2 - point.x, marker.y + marker.height / 2 - point.y),
      };
    });
    check(end !== start && Math.abs(end - start) < 1800, `${label}: direct drag follows nearby recorded branch`, { start, end });
    check(alignment.rayErrorM < 60 && alignment.markerErrorPx < 2, `${label}: marker aligns to visible pitched terrain`, alignment);
    await page.screenshot({ path: `${OUT}/${slug}-direct-drag.png` });
    await context.close();
  }

  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto(`${BASE}/#/lab/design-seeds/d/story/17654151284?at=7572`);
  await ready(page);
  await page.waitForTimeout(1500);
  const session = await context.newCDPSession(page);
  const leaf = page.locator(".seed-leaf-sheet");
  const before = await leaf.evaluate(element => element.scrollTop);
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 210, y: 720 }] });
  for (let i = 1; i <= 12; i++) {
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 210, y: 720 - i * 22 }] });
    await page.waitForTimeout(25);
  }
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(600);
  const after = await leaf.evaluate(element => element.scrollTop);
  check(after > before + 100, "Kyoto phone ordinary touch scrolls reading page", { before, after });
  check(Number(await page.locator(".seed-ribbon").getAttribute("aria-valuenow")) === 7572, "ordinary scrolling does not scrub the route");
  await page.screenshot({ path: `${OUT}/kyoto-mobile-reading.png` });
  await context.close();
} finally {
  await browser.close();
  await writeFile(`${OUT}/manipulation.json`, JSON.stringify(checks, null, 2));
}
process.exitCode = checks.every(check => check.ok) ? 0 : 1;

/** Live MapLibre/DEM checks beyond the recorded three journeys. No Google claims. */
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE = process.env.BASE ?? "http://localhost:8787";
const OUT = process.env.OUT ?? "/tmp/direction-d-resilience";
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ headless: process.env.HEADLESS === "1" || process.platform !== "darwin" });
const results = [];
const check = (ok, name, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? "ok" : "FAIL"} ${name}`, detail ?? ""); };
const ready = page => page.locator('[data-terrain-state="ready"]').first().waitFor({ timeout: 60000 });
const held = async page => Number(await page.locator(".seed-ribbon").getAttribute("aria-valuenow"));

try {
  for (const slug of ["14080158961", "8788967538", "15182597704", "17665674778"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    const route = await (await context.request.get(`${BASE}/data/routes/${slug}.json`)).json();
    const at = Math.round(route.route.at(-1).d * 0.45);
    await page.goto(`${BASE}/#/lab/design-seeds/d/story/${slug}?at=${at}&region=${encodeURIComponent(route.region)}`);
    await ready(page);
    await page.getByRole("button", { name: "Explore the landscape", exact: true }).click();
    const before = await page.evaluate(() => window.__reliefMap.getCenter().toArray());
    await page.mouse.move(1000, 400); await page.mouse.down(); await page.mouse.move(1120, 440, { steps: 8 }); await page.mouse.up();
    const after = await page.evaluate(() => window.__reliefMap.getCenter().toArray());
    check(before.some((n, i) => Math.abs(n - after[i]) > 0.0001), `${slug}: explicit exploration pans the land`);
    await page.getByRole("button", { name: "Finish exploring the landscape" }).click();
    check(await held(page) === at, `${slug}: exploration retains inspection`);
    await page.getByRole("button", { name: "Set the page aside" }).click();
    const selected = await held(page);
    await page.getByRole("button", { name: /^Enter at/ }).click();
    await page.getByTestId("replay-stage").waitFor();
    check(Number(await page.getByTestId("replay-stage").getAttribute("data-progress")) === selected, `${slug}: reduced-motion entry preserves exact distance`);
    await page.waitForTimeout(2000);
    const geometry = await page.evaluate(async () => {
      const map = window.__reliefMap;
      const at = (await map.getSource("relief-position").getData()).features[0].geometry.coordinates;
      const p = map.project(at), back = map.unproject(p);
      const errorM = Math.hypot((back.lng - at[0]) * Math.cos(at[1] * Math.PI / 180), back.lat - at[1]) * 111320;
      return { errorM, pitch: map.getPitch(), x: p.x, y: p.y, segments: (await map.getSource("relief-route").getData()).features.length };
    });
    check(geometry.errorM < 50, `${slug}: held point is on the visible terrain surface`, geometry);
    check(geometry.segments > 1, `${slug}: recorded gaps remain absent from the drawn line`);
    await page.screenshot({ path: path.join(OUT, `${slug}-replay.png`) });
    await page.getByRole("link", { name: "Route story", exact: true }).click();
    await page.locator(".seed-ribbon").waitFor();
    check(await page.getByRole("button", { name: "Open the page", exact: true }).count() === 1, `${slug}: return remembers the page set aside`);
    await page.getByRole("button", { name: "Open the page", exact: true }).click();
    await page.locator("header a").first().click();
    if (slug === "14080158961") {
      await ready(page);
      check(await page.locator("ol li").count() > 5, "Crete remains a regional collection");
      await page.screenshot({ path: path.join(OUT, "crete-region.png") });
    }
    await context.close();
  }

  for (const state of ["delayed", "unavailable"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await context.route("**/elevation-tiles-prod/**", async route => {
      if (state === "unavailable") await route.abort();
      else { await gate; await route.continue().catch(() => {}); }
    });
    const page = await context.newPage();
    await page.goto(`${BASE}/#/lab/design-seeds/d/story/15573295095?at=12000`);
    await page.locator(".seed-thread-grab").waitFor();
    const handle = page.locator(".seed-thread-grab");
    await handle.focus(); await handle.press("ArrowRight");
    const selected = await held(page);
    check(selected > 12000, `${state}: keyboard inspection works without DEM`);
    check(await page.locator("button:disabled").filter({ hasText: /landscape/i }).count() > 0, `${state}: entry does not imply terrain is ready`);
    if (state === "delayed") {
      const box = await handle.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
      release(); await ready(page);
      check(await held(page) === selected, "DEM arrival under a held pointer retains the selected distance");
      await page.mouse.up();
    } else {
      await page.locator('[data-terrain-state="partial"]').first().waitFor({ timeout: 20000 });
      check(await held(page) === selected, "unavailable terrain retains inspection");
    }
    await page.screenshot({ path: path.join(OUT, `${state}-terrain.png`) });
    await context.close();
  }
} finally {
  await browser.close();
  await writeFile(path.join(OUT, "checks.json"), JSON.stringify(results, null, 2));
}
process.exitCode = results.every(r => r.ok) ? 0 : 1;
